import express from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { supabase } from '../utils/supabase';
import { sendEmail } from '../utils/email';
import {
  getAccessibleDepartmentIdsForUser,
  getLatestConfiguredFiscalYear,
  syncUserDepartmentToActiveYear
} from '../utils/fiscal';
import {
  allocationTotalsMatchRequest,
  buildDepartmentBudgetSummaryMap,
  enrichRequests,
  fetchRequestAllocationsByRequestId,
  normalizeAllocations
} from '../utils/budget';
import { validateExpense, OFFICIAL_EXPENSE_LIST } from '../utils/expenseValidator';

const router = express.Router();

const toNumber = (value: unknown) => Number.parseFloat(String(value ?? 0)) || 0;
const toText = (value: unknown) => String(value ?? '').trim();
const REQUEST_RELATIONS_SELECT = `
  *,
  users:users!fk_expense_requests_employee_id(name),
  departments:departments!fk_expense_requests_department_id(name, fiscal_year)
`;

type AttachmentInput = {
  file_name?: string;
  file_url?: string;
  attachment_type?: string;
  attachment_scope?: string;
};

const normalizeAttachments = (attachments: AttachmentInput[] = []) =>
  attachments
    .map((attachment) => ({
      file_name: toText(attachment.file_name),
      file_url: toText(attachment.file_url),
      attachment_type: toText(attachment.attachment_type),
      attachment_scope: ['request', 'disbursement', 'liquidation'].includes(toText(attachment.attachment_scope))
        ? toText(attachment.attachment_scope)
        : 'request'
    }))
    .filter((attachment) => attachment.file_name && attachment.file_url);

const appendWorkflowData = async (rows: any[]) => {
  if (!rows.length) return rows;

  const requestIds = rows.map((row) => row.id);
  const [attachmentsResult, liquidationResult] = await Promise.all([
    supabase
      .from('request_attachments')
      .select('id, request_id, liquidation_id, attachment_scope, attachment_type, file_name, file_url, mime_type, file_size_bytes, uploaded_at')
      .in('request_id', requestIds)
      .order('uploaded_at', { ascending: true }),
    supabase
      .from('request_liquidations')
      .select('id, request_id, liquidation_no, status, due_at, submitted_at, reviewed_at, actual_amount, reimbursable_amount, cash_return_amount, shortage_amount, remarks, created_at, updated_at')
      .in('request_id', requestIds)
      .order('created_at', { ascending: false })
  ]);

  if (attachmentsResult.error) throw attachmentsResult.error;
  if (liquidationResult.error) throw liquidationResult.error;

  const attachmentsByRequestId = new Map<string, any[]>();
  (attachmentsResult.data || []).forEach((attachment: any) => {
    const current = attachmentsByRequestId.get(attachment.request_id) || [];
    current.push(attachment);
    attachmentsByRequestId.set(attachment.request_id, current);
  });

  const latestLiquidationByRequestId = new Map<string, any>();
  (liquidationResult.data || []).forEach((liquidation: any) => {
    if (!latestLiquidationByRequestId.has(liquidation.request_id)) {
      latestLiquidationByRequestId.set(liquidation.request_id, liquidation);
    }
  });

  return rows.map((row) => ({
    ...row,
    attachments: attachmentsByRequestId.get(row.id) || [],
    attachment_count: (attachmentsByRequestId.get(row.id) || []).length,
    latest_liquidation: latestLiquidationByRequestId.get(row.id) || null
  }));
};

const appendWorkflowDataToRequests = async (rows: any[]) => appendWorkflowData(rows);

const insertAuditLogs = async (
  requestId: string,
  actorId: string,
  entries: Array<{
    entity_type: 'request' | 'allocation' | 'attachment' | 'liquidation' | 'release';
    action: string;
    field_name?: string;
    old_value?: string;
    new_value?: string;
    note?: string;
    metadata?: Record<string, unknown>;
  }>
) => {
  if (!entries.length) return;

  const { error } = await supabase.from('request_audit_logs').insert(
    entries.map((entry) => ({
      request_id: requestId,
      actor_id: actorId,
      entity_type: entry.entity_type,
      action: entry.action,
      field_name: entry.field_name || null,
      old_value: entry.old_value || null,
      new_value: entry.new_value || null,
      note: entry.note || null,
      metadata: entry.metadata || {}
    }))
  );

  if (error) throw error;
};

const createLiquidationNumber = (requestCode: string) => `LIQ-${requestCode}-${Date.now()}`;

const releaseRequest = async (
  request: any,
  actorId: string,
  payload: {
    release_method?: string;
    release_reference_no?: string;
    release_note?: string;
    liquidation_due_at?: string;
  }
) => {
  const allocationsByRequestId = await fetchRequestAllocationsByRequestId([request.id]);
  const normalizedAllocations = normalizeAllocations(request, allocationsByRequestId.get(request.id) || []);
  if (!allocationTotalsMatchRequest(request.amount, normalizedAllocations)) {
    throw new Error('Finalize the department allocations before release. The allocated total must match the request amount.');
  }

  const { summaryByDepartmentId } = await buildDepartmentBudgetSummaryMap();
  
  // Check Petty Cash specifically if that is the method
  const releaseMethod = ['cash', 'bank_transfer', 'check', 'petty_cash', 'other'].includes(toText(payload.release_method))
    ? toText(payload.release_method)
    : 'other';

  if (releaseMethod === 'petty_cash') {
    const { data: dept, error: deptErr } = await supabase
      .from('departments')
      .select('name, petty_cash_balance')
      .eq('id', request.department_id)
      .single();
    
    if (deptErr) throw new Error('Could not verify petty cash balance.');
    if (toNumber(dept.petty_cash_balance) < toNumber(request.amount)) {
      throw new Error(`Insufficient petty cash in ${dept.name}. Balance: ${toNumber(dept.petty_cash_balance).toFixed(2)}`);
    }
  }

  const insufficientDepartment = normalizedAllocations.find((allocation) => {
    const summary = summaryByDepartmentId.get(allocation.department_id);
    return !summary || summary.projected_remaining_budget < 0;
  });

  if (insufficientDepartment) {
    const summary = summaryByDepartmentId.get(insufficientDepartment.department_id);
    throw new Error(`Insufficient projected budget for ${summary?.department_name || 'the selected department'}.`);
  }

  for (const allocation of normalizedAllocations) {
    const { data: department, error: departmentError } = await supabase
      .from('departments')
      .select('id, used_budget, petty_cash_balance')
      .eq('id', allocation.department_id)
      .single();

    if (departmentError || !department) {
      throw new Error(departmentError?.message || 'Department not found.');
    }

    const updatePayload: any = {
      used_budget: toNumber(department.used_budget) + toNumber(allocation.amount),
      updated_at: new Date()
    };

    if (releaseMethod === 'petty_cash') {
      updatePayload.petty_cash_balance = toNumber(department.petty_cash_balance) - toNumber(allocation.amount);
    }

    const { error: updateDepartmentError } = await supabase
      .from('departments')
      .update(updatePayload)
      .eq('id', allocation.department_id);

    if (updateDepartmentError) {
      throw updateDepartmentError;
    }

    // Deduct from category budgets for this allocation's department
    // For multi-item requests: fetch request_items and deduct per item's category
    const { data: requestItems } = await supabase
      .from('request_items')
      .select('category_id, amount')
      .eq('request_id', request.id);

    if (requestItems && requestItems.length > 0) {
      // Multi-item: deduct each item's category proportionally
      // If this allocation is a split, scale item amounts by (allocation.amount / request.amount)
      const scaleFactor = toNumber(request.amount) > 0 ? toNumber(allocation.amount) / toNumber(request.amount) : 1;

      for (const rItem of requestItems) {
        if (!rItem.category_id) continue;
        const itemAmountToDeduct = toNumber(rItem.amount) * scaleFactor;

        const { data: catBudget } = await supabase
          .from('budget_categories')
          .select('id, committed_amount, used_amount, budget_amount, remaining_amount')
          .eq('id', rItem.category_id)
          .eq('department_id', allocation.department_id)
          .maybeSingle();

        if (!catBudget) continue;

        const newCommitted = Math.max(0, toNumber(catBudget.committed_amount) - itemAmountToDeduct);
        const newUsed = toNumber(catBudget.used_amount) + itemAmountToDeduct;
        const newRemaining = Math.max(0, toNumber(catBudget.budget_amount) - newUsed - newCommitted);

        const { error: updateCatErr } = await supabase
          .from('budget_categories')
          .update({ used_amount: newUsed, committed_amount: newCommitted, remaining_amount: newRemaining, updated_at: new Date() })
          .eq('id', catBudget.id);

        if (updateCatErr) console.error('Failed to update category on release:', updateCatErr);
      }
    } else if (request.category) {
      // Single-item fallback: use request.category name
      const categoryName = String(request.category).trim();
      const { data: categoryBudget, error: fetchCategoryError } = await supabase
        .from('budget_categories')
        .select('*')
        .eq('category_name', categoryName)
        .eq('department_id', allocation.department_id)
        .eq('fiscal_year', request.fiscal_year)
        .single();

      if (!fetchCategoryError && categoryBudget) {
        const amountToDeduct = toNumber(allocation.amount);
        const newCommitted = Math.max(0, toNumber(categoryBudget.committed_amount) - amountToDeduct);
        const newUsedAmount = toNumber(categoryBudget.used_amount) + amountToDeduct;
        const newRemainingAmount = Math.max(0, toNumber(categoryBudget.budget_amount) - newUsedAmount - newCommitted);

        const { error: updateCategoryError } = await supabase
          .from('budget_categories')
          .update({ used_amount: newUsedAmount, committed_amount: newCommitted, remaining_amount: newRemainingAmount, updated_at: new Date() })
          .eq('id', categoryBudget.id);

        if (updateCategoryError) console.error('Failed to update category budget on release:', updateCategoryError);
      }
    }
  }

  const releaseReferenceNo = toText(payload.release_reference_no);
  const releaseNote = toText(payload.release_note);
  const releasedAt = new Date().toISOString();
  const liquidationDueAt = toText(payload.liquidation_due_at);

  const { data, error } = await supabase
    .from('expense_requests')
    .update({
      status: 'released',
      disbursement_status: 'released',
      release_method: releaseMethod,
      release_reference_no: releaseReferenceNo || null,
      release_note: releaseNote || null,
      released_by: actorId,
      released_at: releasedAt,
      updated_at: new Date()
    })
    .eq('id', request.id)
    .select()
    .single();

  if (error) throw error;

  if (liquidationDueAt) {
    const { data: existingLiquidation } = await supabase
      .from('request_liquidations')
      .select('id')
      .eq('request_id', request.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingLiquidation?.id) {
      const { error: updateLiquidationError } = await supabase
        .from('request_liquidations')
        .update({
          due_at: liquidationDueAt,
          updated_at: new Date()
        })
        .eq('id', existingLiquidation.id);

      if (updateLiquidationError) throw updateLiquidationError;
    } else {
      const { error: insertLiquidationError } = await supabase.from('request_liquidations').insert({
        request_id: request.id,
        liquidation_no: createLiquidationNumber(request.request_code),
        due_at: liquidationDueAt,
        created_by: actorId,
        created_at: new Date(),
        updated_at: new Date()
      });

      if (insertLiquidationError) throw insertLiquidationError;
    }
  }

  // Create cash_advances record for cash advance type requests
  if (request.request_type === 'cash_advance') {
    const { data: existingCashAdvance } = await supabase
      .from('cash_advances')
      .select('id')
      .eq('request_id', request.id)
      .maybeSingle();

    if (!existingCashAdvance) {
      const advanceCode = `CA-${Date.now()}`;
      const { error: insertCashAdvanceError } = await supabase.from('cash_advances').insert({
        advance_code: advanceCode,
        request_id: request.id,
        employee_id: request.employee_id,
        department_id: request.department_id,
        amount_issued: toNumber(request.amount),
        balance: toNumber(request.amount),
        amount_liquidated: 0,
        status: 'outstanding',
        purpose: request.purpose || '',
        liquidation_due_at: liquidationDueAt ? new Date(liquidationDueAt) : null,
        issued_by: actorId,
        issued_at: new Date(),
        created_at: new Date(),
        updated_at: new Date()
      });

      if (insertCashAdvanceError) {
        console.error('Failed to create cash_advances record:', insertCashAdvanceError);
        // Don't throw error to allow request release to proceed
      }
    }
  }

  await supabase.from('approval_logs').insert({
    request_id: request.id,
    actor_id: actorId,
    action: 'released',
    stage: 'finance',
    note: releaseNote || `Released via ${releaseMethod}`
  });

  await supabase.from('allocation_logs').insert({
    request_id: request.id,
    actor_id: actorId,
    action: 'released',
    note: `Released via ${releaseMethod}${releaseReferenceNo ? ` (Ref ${releaseReferenceNo})` : ''}`
  });

  // Build audit log entries for all budget deductions
  const auditEntries: any[] = [
    {
      entity_type: 'request',
      action: 'status_changed',
      field_name: 'status',
      old_value: request.status,
      new_value: 'released',
      note: releaseNote || 'Released by accounting'
    },
    {
      entity_type: 'release',
      action: 'released',
      field_name: 'release_method',
      old_value: request.release_method || '',
      new_value: releaseMethod,
      note: releaseReferenceNo || undefined,
      metadata: {
        release_reference_no: releaseReferenceNo,
        liquidation_due_at: liquidationDueAt || null
      }
    }
  ];

  // Add audit logs for department budget deductions
  for (const allocation of normalizedAllocations) {
    const { data: dept } = await supabase
      .from('departments')
      .select('name')
      .eq('id', allocation.department_id)
      .single();
    
    auditEntries.push({
      entity_type: 'request',
      action: 'department_budget_deducted',
      field_name: 'used_budget',
      old_value: '',
      new_value: String(allocation.amount),
      note: `Department budget deducted for ${dept?.name || allocation.department_id}`
    });

    // Add audit log for category budget if applicable
    if (request.category) {
      const categoryName = String(request.category).trim();
      const { data: categoryBudget } = await supabase
        .from('budget_categories')
        .select('category_name, used_amount')
        .eq('category_name', categoryName)
        .eq('department_id', allocation.department_id)
        .eq('fiscal_year', request.fiscal_year)
        .single();

      if (categoryBudget) {
        auditEntries.push({
          entity_type: 'request',
          action: 'category_budget_deducted',
          field_name: 'used_amount',
          old_value: String(categoryBudget.used_amount),
          new_value: String((parseFloat(categoryBudget.used_amount?.toString() || '0') + toNumber(allocation.amount)).toFixed(2)),
          note: `Category budget deducted for ${categoryName}`
        });
      }
    }
  }

  await insertAuditLogs(request.id, actorId, auditEntries);

  return data;
};

const notifyEmployee = async (employeeId: string, subject: string, message: string) => {
  try {
    const { data: employee } = await supabase.from('users').select('email').eq('id', employeeId).maybeSingle();
    if (employee?.email) {
      // Don't await sendEmail to avoid blocking the main flow
      sendEmail(employee.email, subject, message).catch(err => {
        console.error(`Failed to send email to ${employee.email}:`, err.message);
      });
    }
  } catch (err) {
    console.error('Error in notifyEmployee:', err);
  }
};

// GET /api/requests/official-list - get filtered official expense list based on department budgets
router.get('/official-list', authenticate, async (req: any, res) => {
  const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
  
  // Get user's department categories with budget
  const departmentId = req.user.department_id;
  
  if (!departmentId) {
    // For users without departments (vp, president, admin, etc.), return full list
    return res.json(OFFICIAL_EXPENSE_LIST);
  }
  
  // Fetch budget categories for the user's department
  const { data: budgetCategories, error: budgetError } = await supabase
    .from('budget_categories')
    .select('category_name')
    .eq('department_id', departmentId)
    .eq('fiscal_year', activeFiscalYear);
  
  if (budgetError || !budgetCategories || budgetCategories.length === 0) {
    // If no budget categories found, return empty list or full list based on preference
    // Returning empty list to prevent submitting to categories without budget
    return res.json([]);
  }
  
  // Extract category names that have budget
  const allowedCategories = budgetCategories.map(bc => bc.category_name);
  
  // Filter official expense list to only include items from categories with budget
  const filteredList = OFFICIAL_EXPENSE_LIST.filter(item => {
    // Use the item's category property directly
    return allowedCategories.includes(item.category);
  });
  
  res.json(filteredList);
});

// GET /api/requests - list filtered by role/dept
router.get('/', authenticate, async (req: any, res) => {
  const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
  // accounting/admin/super_admin see all years by default; others scoped to active FY unless ?all_years=true
  const allYears = req.query.all_years === 'true' || ['accounting', 'admin', 'super_admin'].includes(req.user.role);
  let query = supabase.from('expense_requests').select(REQUEST_RELATIONS_SELECT);
  if (!allYears) {
    query = query.eq('fiscal_year', activeFiscalYear);
  }
  if (req.user.role === 'employee' || req.user.role === 'manager') {
    query = query.eq('employee_id', req.user.id);
  } else if (req.user.role === 'supervisor') {
    const accessibleDepartmentIds = await getAccessibleDepartmentIdsForUser(supabase, req.user, activeFiscalYear);
    query = accessibleDepartmentIds.length
      ? query.in('department_id', accessibleDepartmentIds)
      : query.eq('department_id', req.user.department_id);
  }

  const { data, error } = await query.order('submitted_at', { ascending: false });
  if (error) return res.status(400).json({ error });

  try {
    const { summaryByDepartmentId, allocationsByRequestId } = await buildDepartmentBudgetSummaryMap();
    const enrichedRows = enrichRequests(data || [], summaryByDepartmentId, allocationsByRequestId);
    res.json(await appendWorkflowDataToRequests(enrichedRows));
  } catch (summaryError: any) {
    res.status(400).json({ error: summaryError?.message || summaryError });
  }
});

// GET /api/requests/my - get current user's requests (alias for employees)
router.get('/my', authenticate, async (req: any, res) => {
  const { data, error } = await supabase
    .from('expense_requests')
    .select(REQUEST_RELATIONS_SELECT)
    .eq('employee_id', req.user.id)
    .order('submitted_at', { ascending: false });

  if (error) return res.status(400).json({ error });

  try {
    const { summaryByDepartmentId, allocationsByRequestId } = await buildDepartmentBudgetSummaryMap();
    const enrichedRows = enrichRequests(data || [], summaryByDepartmentId, allocationsByRequestId);
    res.json(await appendWorkflowDataToRequests(enrichedRows));
  } catch (summaryError: any) {
    res.status(400).json({ error: summaryError?.message || summaryError });
  }
});

// POST /api/requests - submit new (employee, supervisor, or accounting)
router.post('/', authenticate, authorize('employee', 'manager', 'supervisor', 'accounting'), async (req: any, res) => {
  const { item_name, category, category_id, amount, purpose, priority, department_id, request_type = 'reimbursement', attachments = [], metadata = {}, items = [] } = req.body;
  const request_code = `REQ-${Date.now()}`;
  const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
  const userRole = req.user.role;
  
  // Use provided department_id if user is admin/accounting, otherwise use user's own department
  const targetDepartmentId = (userRole === 'admin' || userRole === 'accounting') && department_id 
    ? department_id 
    : req.user.department_id;

  const activeDepartment = { id: targetDepartmentId, fiscal_year: activeFiscalYear };
  const normalizedAttachments = normalizeAttachments(attachments);
  const initialStatus = (userRole === 'employee' || userRole === 'manager') ? 'pending_supervisor' : 'pending_accounting';
  
  // 1. Validate against Official Expense List
  const { data: deptData } = await supabase.from('departments').select('name').eq('id', targetDepartmentId).single();
  const departmentName = deptData?.name || 'Unknown';
  
  // If multiple items provided, validate each one
  if (items && items.length > 0) {
    for (const item of items) {
      const validation = validateExpense(item.item_name, departmentName, request_type);
      if (!validation.allowed) {
        return res.status(400).json({ 
          error: `Invalid item "${item.item_name}": ${validation.reason}`,
          details: {
            code: validation.code,
            category: validation.category,
            required_department: validation.department,
            can_ca: validation.canCA,
            can_re: validation.canRE
          }
        });
      }
    }
  } else {
    const validation = validateExpense(item_name, departmentName, request_type);
    if (!validation.allowed) {
      return res.status(400).json({ 
        error: validation.reason,
        details: {
          code: validation.code,
          category: validation.category,
          required_department: validation.department,
          can_ca: validation.canCA,
          can_re: validation.canRE
        }
      });
    }
  }

  // 2. Validate category budget before submission (check per category for multiple items)
  const totalAmount = toNumber(amount);
  
  if (items && items.length > 0 && targetDepartmentId) {
    // Group items by category and sum amounts
    const categoryTotals = items.reduce((acc: Record<string, number>, item: any) => {
      const catName = item.category || category;
      if (catName) {
        acc[catName] = (acc[catName] || 0) + toNumber(item.amount);
      }
      return acc;
    }, {});
    
    // Validate budget for each category
    for (const [catName, catTotalAmount] of Object.entries(categoryTotals)) {
      const catTotal = toNumber(catTotalAmount);
      const { data: categoryBudget, error: categoryError } = await supabase
        .from('budget_categories')
        .select('id, budget_amount, used_amount, committed_amount, remaining_amount')
        .eq('category_name', catName)
        .eq('department_id', targetDepartmentId)
        .eq('fiscal_year', activeDepartment.fiscal_year)
        .single();
      
      if (categoryError && categoryError.code !== 'PGRST116') {
        return res.status(400).json({ error: `Failed to validate budget for category "${catName}"` });
      }
      
      if (!categoryBudget) {
        return res.status(400).json({ 
          error: `No budget allocated for "${catName}" in your department`,
          message: `Please contact your department's accounting team to set up a budget for "${catName}" category.`,
          code: 'NO_BUDGET_CATEGORY',
          category: catName,
          department_id: targetDepartmentId,
          fiscal_year: activeDepartment.fiscal_year
        });
      }
      
      const remaining = toNumber(categoryBudget.remaining_amount);
      
      if (remaining < catTotal) {
        return res.status(400).json({ 
          error: `Insufficient budget in category "${catName}". Available: ${remaining.toFixed(2)}, Requested: ${catTotal.toFixed(2)}` 
        });
      }
    }
  } else if (category && targetDepartmentId) {
    // Single item/category validation (original logic)
    const { data: categoryBudget, error: categoryError } = await supabase
      .from('budget_categories')
      .select('id, budget_amount, used_amount, committed_amount, remaining_amount')
      .eq('category_name', category)
      .eq('department_id', targetDepartmentId)
      .eq('fiscal_year', activeDepartment.fiscal_year)
      .single();
    
    if (categoryError && categoryError.code !== 'PGRST116') {
      return res.status(400).json({ error: 'Failed to validate category budget' });
    }
    
    if (!categoryBudget) {
      return res.status(400).json({ 
        error: `No budget allocated for "${category}" in your department`,
        message: `Please contact your department's accounting team to set up a budget for "${category}" category.`,
        code: 'NO_BUDGET_CATEGORY',
        category: category,
        department_id: targetDepartmentId,
        fiscal_year: activeDepartment.fiscal_year
      });
    }
    
    const remaining = toNumber(categoryBudget.remaining_amount);
    
    if (remaining < totalAmount) {
      return res.status(400).json({ 
        error: `Insufficient budget in category "${category}". Available: ${remaining.toFixed(2)}, Requested: ${totalAmount.toFixed(2)}` 
      });
    }
  }
  
  const { data, error } = await supabase
    .from('expense_requests')
    .insert({
      request_code: request_code,
      employee_id: req.user.id,
      department_id: activeDepartment.id,
      fiscal_year: activeDepartment.fiscal_year,
      item_name: items && items.length > 0 ? `${items.length} items: ${items.map((i: any) => i.item_name?.split('|')[0]?.trim() || i.item_name).join(', ')}` : item_name,
      category: category || (items && items.length > 0 ? items[0]?.category : null),
      category_id: category_id || null,
      amount: totalAmount,
      purpose,
      priority,
      status: initialStatus,
      submitted_at: new Date(),
      metadata: { ...metadata, items },
      request_type: request_type
    })
    .select()
    .single();
  if (error || !data) return res.status(400).json({ error: error || 'Failed to create request' });

  // Insert individual items into request_items table if multiple items provided
  if (items && items.length > 0) {
    const requestItems = items.map((item: any) => ({
      request_id: data.id,
      item_name: item.item_name,
      category_id: item.category_id || null,
      amount: toNumber(item.amount)
    }));
    
    const { error: itemsError } = await supabase.from('request_items').insert(requestItems);
    if (itemsError) {
      console.error('Failed to insert request items:', itemsError);
      return res.status(400).json({ error: 'Failed to save request items: ' + itemsError.message });
    }
  }

  // Update committed_amount in budget_categories for each item's category
  if (items && items.length > 0) {
    // Multiple items: commit each item's category individually
    for (const item of items) {
      const itemCategoryId = item.category_id || (item.category ? (await supabase.from('budget_categories').select('id').eq('category_name', String(item.category).trim()).eq('department_id', targetDepartmentId).eq('fiscal_year', activeFiscalYear).maybeSingle()).data?.id : null);
      if (!itemCategoryId) continue;

      const { data: catBudget } = await supabase.from('budget_categories').select('committed_amount, remaining_amount').eq('id', itemCategoryId).single();
      if (catBudget) {
        const itemAmt = toNumber(item.amount);
        await supabase.from('budget_categories').update({
          committed_amount: toNumber(catBudget.committed_amount) + itemAmt,
          remaining_amount: Math.max(0, toNumber(catBudget.remaining_amount) - itemAmt),
          updated_at: new Date()
        }).eq('id', itemCategoryId);
      }
    }
    // Store first item's category_id on the request if not already set
    if (!category_id && items[0]?.category_id) {
      await supabase.from('expense_requests').update({ category_id: items[0].category_id }).eq('id', data.id);
    }
  } else {
    // Single item: original logic
    const effectiveCategoryId = category_id || (category ? (await supabase.from('budget_categories').select('id').eq('category_name', category.trim()).eq('department_id', targetDepartmentId).eq('fiscal_year', activeFiscalYear).maybeSingle()).data?.id : null);
    if (effectiveCategoryId) {
      const { data: categoryBudget } = await supabase.from('budget_categories').select('committed_amount, remaining_amount').eq('id', effectiveCategoryId).single();
      if (categoryBudget) {
        const requestAmount = toNumber(amount);
        await supabase.from('budget_categories').update({
          committed_amount: toNumber(categoryBudget.committed_amount) + requestAmount,
          remaining_amount: Math.max(0, toNumber(categoryBudget.remaining_amount) - requestAmount),
          updated_at: new Date()
        }).eq('id', effectiveCategoryId);
        if (!category_id) {
          await supabase.from('expense_requests').update({ category_id: effectiveCategoryId }).eq('id', data.id);
        }
      }
    }
  }

  if (normalizedAttachments.length) {
    const { error: attachmentError } = await supabase.from('request_attachments').insert(
      normalizedAttachments.map((attachment: AttachmentInput) => ({
        request_id: data.id,
        attachment_scope: attachment.attachment_scope,
        attachment_type: attachment.attachment_type || null,
        file_name: attachment.file_name,
        file_url: attachment.file_url,
        uploaded_by: req.user.id
      }))
    );

    if (attachmentError) return res.status(400).json({ error: attachmentError });
  }

  await supabase.from('approval_logs').insert({
    request_id: data.id,
    actor_id: req.user.id,
    action: 'submitted',
    stage: (userRole === 'employee' || userRole === 'manager') ? 'supervisor' : 'accounting',
    note: (userRole === 'employee' || userRole === 'manager') ? 'Request submitted' : `Request submitted by ${userRole} (routed directly to accounting)`
  });

  // Notify based on role
  if (userRole === 'employee' || userRole === 'manager') {
    // Notify supervisor
    try {
      const { data: supervisor } = await supabase
        .from('users')
        .select('email')
        .eq('department_id', req.user.department_id)
        .eq('role', 'supervisor')
        .maybeSingle();

      if (supervisor?.email) {
        sendEmail(supervisor.email, 'New Expense Request', `New request ${request_code} submitted.`).catch(err => {
          console.error('Failed to notify supervisor:', err.message);
        });
      }
    } catch (err) {
      console.error('Error finding supervisor for notification:', err);
    }
  } else {
    // Notify accounting staff
    const { data: accountingStaff } = await supabase.from('users').select('email').eq('role', 'accounting');
    if (accountingStaff) {
      for (const accountant of accountingStaff) {
        if (accountant.email) {
          sendEmail(accountant.email, 'New Direct Request', `New direct request from ${userRole} ${req.user.name || req.user.email}: ${request_code} requires accounting review.`).catch(err => {
            console.error('Failed to notify accountant:', err.message);
          });
        }
      }
    }
  }

  const responseRows = await appendWorkflowDataToRequests([{ ...data, attachments: normalizedAttachments }]);
  res.json(responseRows[0]);
});

// GET /api/requests/audit-logs
router.get('/audit-logs', authenticate, authorize('accounting', 'admin', 'super_admin'), async (req: any, res) => {

  const [approvalLogsResult, allocationLogsResult, auditLogsResult] = await Promise.all([
    supabase.from('approval_logs').select('*').order('timestamp', { ascending: false }).limit(150),
    supabase.from('allocation_logs').select('*').order('created_at', { ascending: false }).limit(150),
    supabase.from('request_audit_logs').select('*').order('created_at', { ascending: false }).limit(150)
  ]);

  if (approvalLogsResult.error) return res.status(400).json({ error: approvalLogsResult.error });
  if (allocationLogsResult.error) return res.status(400).json({ error: allocationLogsResult.error });
  if (auditLogsResult.error) return res.status(400).json({ error: auditLogsResult.error });

  const approvalLogs = (approvalLogsResult.data || []).map((log: any) => ({
    ...log,
    log_type: 'approval',
    event_time: log.timestamp
  }));
  const allocationLogs = (allocationLogsResult.data || []).map((log: any) => ({
    ...log,
    log_type: 'allocation',
    event_time: log.created_at
  }));
  const auditLogs = (auditLogsResult.data || []).map((log: any) => ({
    ...log,
    log_type: 'audit',
    event_time: log.created_at
  }));

  const combinedLogs = [...approvalLogs, ...allocationLogs, ...auditLogs]
    .sort((left: any, right: any) => new Date(right.event_time).getTime() - new Date(left.event_time).getTime())
    .slice(0, 200);

  const actorIds = Array.from(new Set(combinedLogs.map((log: any) => log.actor_id).filter(Boolean)));
  const requestIds = Array.from(new Set(combinedLogs.map((log: any) => log.request_id).filter(Boolean)));

  const [{ data: actors }, { data: requests }] = await Promise.all([
    actorIds.length ? supabase.from('users').select('id, name, role').in('id', actorIds) : { data: [] as any[] },
    requestIds.length ? supabase.from('expense_requests').select('id, request_code, item_name, status').in('id', requestIds) : { data: [] as any[] }
  ]);

  const actorMap = new Map((actors || []).map((actor: any) => [actor.id, actor]));
  const requestMap = new Map((requests || []).map((request: any) => [request.id, request]));

  res.json(
    combinedLogs.map((log: any) => ({
      ...log,
      actor_name: actorMap.get(log.actor_id)?.name || 'System',
      actor_role: actorMap.get(log.actor_id)?.role || '',
      request_code: requestMap.get(log.request_id)?.request_code || '',
      item_name: requestMap.get(log.request_id)?.item_name || '',
      request_status: requestMap.get(log.request_id)?.status || ''
    }))
  );
});

// GET /api/requests/:id/audit-logs - Specific logs for a single request
router.get('/:id/audit-logs', authenticate, async (req: any, res) => {
  const { id } = req.params;
  
  // Verify access (same logic as GET /:id)
  const { data: request, error: fetchError } = await supabase
    .from('expense_requests')
    .select('employee_id, department_id')
    .eq('id', id)
    .single();
    
  if (fetchError || !request) return res.status(404).json({ error: 'Request not found' });
  
  if (req.user.role === 'employee' && request.employee_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Fetch all types of logs
  const [approvalLogsResult, allocationLogsResult, auditLogsResult] = await Promise.all([
    supabase.from('approval_logs').select('*').eq('request_id', id).order('timestamp', { ascending: false }),
    supabase.from('allocation_logs').select('*').eq('request_id', id).order('created_at', { ascending: false }),
    supabase.from('request_audit_logs').select('*').eq('request_id', id).order('created_at', { ascending: false })
  ]);

  const approvalLogs = (approvalLogsResult.data || []).map((log: any) => ({
    ...log,
    action: log.action || 'approved',
    created_at: log.timestamp,
    log_type: 'approval'
  }));
  const allocationLogs = (allocationLogsResult.data || []).map((log: any) => ({
    ...log,
    action: log.action || 'allocated',
    created_at: log.created_at,
    log_type: 'allocation'
  }));
  const auditLogs = (auditLogsResult.data || []).map((log: any) => ({
    ...log,
    log_type: 'audit'
  }));

  const combinedLogs = [...approvalLogs, ...allocationLogs, ...auditLogs]
    .sort((left: any, right: any) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());

  const actorIds = Array.from(new Set(combinedLogs.map((log: any) => log.actor_id).filter(Boolean)));
  const { data: actors } = actorIds.length
    ? await supabase.from('users').select('id, name, role').in('id', actorIds)
    : { data: [] as any[] };
  
  const actorMap = new Map((actors || []).map((actor: any) => [actor.id, actor]));

  res.json(
    combinedLogs.map((log: any) => ({
      ...log,
      user: actorMap.get(log.actor_id) || { name: 'System', role: 'system' }
    }))
  );
});

// GET /api/requests/:id
router.get('/:id', authenticate, async (req: any, res) => {
  const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
  const { data, error } = await supabase
    .from('expense_requests')
    .select(REQUEST_RELATIONS_SELECT)
    .eq('id', req.params.id)
    .single();
  if (error) return res.status(400).json({ error });
  if ((req.user.role === 'employee' || req.user.role === 'manager') && data.employee_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  if (req.user.role === 'supervisor') {
    const accessibleDepartmentIds = await getAccessibleDepartmentIdsForUser(supabase, req.user, activeFiscalYear);
    if (!accessibleDepartmentIds.includes(data.department_id)) return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const { summaryByDepartmentId, allocationsByRequestId } = await buildDepartmentBudgetSummaryMap();
    const enrichedRows = enrichRequests([data], summaryByDepartmentId, allocationsByRequestId);
    res.json((await appendWorkflowDataToRequests(enrichedRows))[0]);
  } catch (summaryError: any) {
    res.status(400).json({ error: summaryError?.message || summaryError });
  }
});

// PATCH /api/requests/:id/liquidation
router.patch('/:id/liquidation', authenticate, authorize('employee', 'manager', 'supervisor', 'accounting'), async (req: any, res) => {
  try {
    const { id } = req.params;
    const actualAmount = toNumber(req.body?.actual_amount);
    const remarks = toText(req.body?.remarks);
    const attachments = req.body?.attachments || []; // Support multiple attachments

    const { data: request, error: requestError } = await supabase
      .from('expense_requests')
      .select('*')
      .eq('id', id)
      .single();

    if (requestError || !request) {
      console.error('Request not found or error:', requestError);
      return res.status(400).json({ error: requestError?.message || 'Request not found.' });
    }

    const isTrustedLiquidator = req.user.role === 'supervisor' || req.user.role === 'accounting';
    if (!isTrustedLiquidator && request.employee_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden: You do not own this request.' });
    }

    if (request.status !== 'released') {
      return res.status(400).json({ error: 'Liquidation can only be submitted after the budget has been released.' });
    }

    if (actualAmount <= 0) {
      return res.status(400).json({ error: 'Actual liquidation amount must be greater than zero.' });
    }

    const requestAmount = toNumber(request.amount);
    const reimbursableAmount = Math.max(actualAmount - requestAmount, 0);
    const cashReturnAmount = Math.max(requestAmount - actualAmount, 0);

    const { data: existingLiquidation } = await supabase
      .from('request_liquidations')
      .select('*')
      .eq('request_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let result;
    if (existingLiquidation?.id) {
      result = await supabase
        .from('request_liquidations')
        .update({
          status: 'submitted',
          submitted_at: new Date(),
          actual_amount: actualAmount,
          reimbursable_amount: reimbursableAmount,
          cash_return_amount: cashReturnAmount,
          remarks,
          updated_at: new Date()
        })
        .eq('id', existingLiquidation.id)
        .select()
        .single();
    } else {
      result = await supabase
        .from('request_liquidations')
        .insert({
          request_id: id,
          liquidation_no: createLiquidationNumber(request.request_code),
          status: 'submitted',
          submitted_at: new Date(),
          actual_amount: actualAmount,
          reimbursable_amount: reimbursableAmount,
          cash_return_amount: cashReturnAmount,
          remarks,
          created_by: req.user.id,
          created_at: new Date(),
          updated_at: new Date()
        })
        .select()
        .single();
    }

    if (result.error) {
      console.error('Liquidation save error:', result.error);
      return res.status(400).json({ error: result.error.message });
    }

    // Handle multiple attachments if provided
    if (attachments.length > 0) {
      const { error: attachErr } = await supabase.from('request_attachments').insert(
        attachments.map((att: any) => ({
          request_id: id,
          liquidation_id: result.data.id,
          attachment_scope: 'liquidation',
          attachment_type: 'receipt',
          file_name: att.file_name || `liquidation-receipt-${Date.now()}.png`,
          file_url: att.file_url,
          uploaded_by: req.user.id,
          uploaded_at: new Date()
        }))
      );
      if (attachErr) console.error('Attachments save error:', attachErr);
    }

    try {
      await insertAuditLogs(id, req.user.id, [
        {
          entity_type: 'liquidation',
          action: 'submitted',
          field_name: 'status',
          old_value: existingLiquidation?.status || 'pending_submission',
          new_value: 'submitted',
          note: remarks || 'Liquidation submitted'
        }
      ]);
    } catch (auditErr) {
      console.error('Audit log error during liquidation:', auditErr);
    }

    return res.json(result.data);
  } catch (err: any) {
    console.error('Unexpected liquidation error:', err);
    return res.status(500).json({ error: err.message || 'An unexpected error occurred during liquidation.' });
  }
});

// PATCH /api/requests/:id/allocations
router.patch('/:id/allocations', authenticate, authorize('accounting', 'admin'), async (req: any, res) => {
  const { id } = req.params;
  const { allocations } = req.body as { allocations?: Array<{ department_id?: string; amount?: number | string }> };
  const { data: request, error: requestError } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('id', id)
    .single();

  if (requestError || !request) {
    return res.status(404).json({ error: requestError?.message || 'Request not found.' });
  }

  if (request.status !== 'pending_accounting') {
    return res.status(400).json({ error: 'Allocations can only be updated while waiting for accounting approval.' });
  }

  const normalizedAllocations = normalizeAllocations(request, allocations || []);
  if (!normalizedAllocations.length) {
    return res.status(400).json({ error: 'Add at least one department allocation.' });
  }

  if (!allocationTotalsMatchRequest(request.amount, normalizedAllocations)) {
    return res.status(400).json({ error: 'The total of all department allocations must exactly match the request amount.' });
  }

  // Validate category budget for all allocated departments (if category is specified)
  if (request.category) {
    const categoryName = String(request.category).trim();
    for (const allocation of normalizedAllocations) {
      const { data: categoryBudget, error: catError } = await supabase
        .from('budget_categories')
        .select('id, category_name, budget_amount, used_amount, committed_amount, remaining_amount')
        .eq('category_name', categoryName)
        .eq('department_id', allocation.department_id)
        .eq('fiscal_year', request.fiscal_year)
        .single();
      
      if (!catError && categoryBudget) {
        const remaining = toNumber(categoryBudget.remaining_amount);
        const allocationAmount = toNumber(allocation.amount);
        
        if (remaining < allocationAmount) {
          return res.status(400).json({
            error: `Insufficient budget in category "${categoryName}" for department. Available: ${remaining.toFixed(2)}, Required: ${allocationAmount.toFixed(2)}`
          });
        }
      }
      // If category doesn't exist in this department, that's ok - will deduct from department budget only
    }
  }

  const departmentIds = normalizedAllocations.map((allocation) => allocation.department_id);
  const { data: validDepartments, error: departmentError } = await supabase
    .from('departments')
    .select('id')
    .in('id', departmentIds);

  if (departmentError) return res.status(400).json({ error: departmentError });
  if ((validDepartments || []).length !== departmentIds.length) {
    return res.status(400).json({ error: 'One or more selected departments could not be found.' });
  }

  const { data: existingAllocations, error: existingAllocationsError } = await supabase
    .from('request_allocations')
    .select('id, department_id, amount, departments(name)')
    .eq('request_id', id);
  if (existingAllocationsError) return res.status(400).json({ error: existingAllocationsError });

  const { error: deleteError } = await supabase.from('request_allocations').delete().eq('request_id', id);
  if (deleteError) return res.status(400).json({ error: deleteError });

  const { data: savedAllocations, error: insertError } = await supabase
    .from('request_allocations')
    .insert(
      normalizedAllocations.map((allocation) => ({
        request_id: id,
        department_id: allocation.department_id,
        amount: allocation.amount,
        created_by: req.user.id,
        updated_at: new Date()
      }))
    )
    .select('id, request_id, department_id, amount, departments(name)');

  if (insertError) return res.status(400).json({ error: insertError });

  const oldSummary = (existingAllocations || []).map((a: any) => `${a.departments?.name || a.department_id}:${toNumber(a.amount).toFixed(2)}`).sort().join(', ') || 'none';
  const newSummary = (savedAllocations || []).map((a: any) => `${a.departments?.name || a.department_id}:${toNumber(a.amount).toFixed(2)}`).sort().join(', ');

  if (oldSummary !== newSummary) {
    await supabase.from('allocation_logs').insert({
      request_id: id,
      actor_id: req.user.id,
      action: existingAllocations?.length ? 'reallocated' : 'allocated',
      note: `Allocation updated from [${oldSummary}] to [${newSummary}]`
    });

    await insertAuditLogs(id, req.user.id, [
      {
        entity_type: 'allocation',
        action: existingAllocations?.length ? 'reallocated' : 'allocated',
        old_value: oldSummary,
        new_value: newSummary,
        note: 'Department allocation updated'
      }
    ]);
  }

  // Sync committed_amount in budget_categories for ALL allocated departments
  {
    // Build old/new dept amount maps
    const oldAmountsMap = new Map<string, number>();
    if ((existingAllocations || []).length > 0) {
      (existingAllocations || []).forEach((a: any) => oldAmountsMap.set(a.department_id, toNumber(a.amount)));
    } else {
      oldAmountsMap.set(request.department_id, toNumber(request.amount));
    }
    const newAmountsMap = new Map<string, number>();
    normalizedAllocations.forEach((a) => newAmountsMap.set(a.department_id, toNumber(a.amount)));

    const allDeptIds = new Set([...oldAmountsMap.keys(), ...newAmountsMap.keys()]);
    const requestTotal = toNumber(request.amount);

    // Fetch request_items to check if multi-item
    const { data: allocationItems } = await supabase
      .from('request_items').select('category_id, amount').eq('request_id', id);

    for (const deptId of allDeptIds) {
      const oldAmt = oldAmountsMap.get(deptId) || 0;
      const newAmt = newAmountsMap.get(deptId) || 0;
      const diff = newAmt - oldAmt;
      if (diff === 0) continue;

      if (allocationItems && allocationItems.length > 0) {
        // Multi-item: apply diff proportionally to each item's category in this dept
        for (const rItem of allocationItems) {
          if (!rItem.category_id) continue;
          const itemFraction = requestTotal > 0 ? toNumber(rItem.amount) / requestTotal : 0;
          const itemDiff = diff * itemFraction;
          if (Math.abs(itemDiff) < 0.001) continue;

          const { data: cat } = await supabase
            .from('budget_categories')
            .select('id, committed_amount, remaining_amount')
            .eq('id', rItem.category_id)
            .eq('department_id', deptId)
            .maybeSingle();
          if (!cat) continue;

          await supabase.from('budget_categories').update({
            committed_amount: Math.max(0, toNumber(cat.committed_amount) + itemDiff),
            remaining_amount: Math.max(0, toNumber(cat.remaining_amount) - itemDiff),
            updated_at: new Date()
          }).eq('id', cat.id);
        }
      } else if (request.category || request.category_id) {
        // Single-item fallback: use request.category
        const categoryName = request.category ? String(request.category).trim() : null;
        let catQuery = supabase
          .from('budget_categories')
          .select('id, committed_amount, remaining_amount')
          .eq('department_id', deptId)
          .eq('fiscal_year', request.fiscal_year);

        if (request.category_id && deptId === request.department_id) {
          catQuery = catQuery.eq('id', request.category_id);
        } else if (categoryName) {
          catQuery = catQuery.eq('category_name', categoryName);
        } else {
          continue;
        }

        const { data: cat } = await catQuery.maybeSingle();
        if (!cat) continue;

        await supabase.from('budget_categories').update({
          committed_amount: Math.max(0, toNumber(cat.committed_amount) + diff),
          remaining_amount: Math.max(0, toNumber(cat.remaining_amount) - diff),
          updated_at: new Date()
        }).eq('id', cat.id);
      }
    }
  }

  res.json(savedAllocations || []);
});

// PATCH /api/requests/:id/priority
router.patch('/:id/priority', authenticate, authorize('supervisor', 'admin'), async (req: any, res) => {
  const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
  const { id } = req.params;
  const normalizedPriority = toText(req.body?.priority).toLowerCase();

  if (!['low', 'normal', 'urgent'].includes(normalizedPriority)) {
    return res.status(400).json({ error: 'Priority must be low, normal, or urgent.' });
  }

  const { data: request, error: fetchError } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError || !request) return res.status(404).json({ error: fetchError?.message || 'Request not found.' });

  if (req.user.role === 'supervisor') {
    const accessibleDepartmentIds = await getAccessibleDepartmentIdsForUser(supabase, req.user, activeFiscalYear);
    if (!accessibleDepartmentIds.includes(request.department_id)) return res.status(403).json({ error: 'Forbidden' });
  }

  if (request.status !== 'pending_supervisor') {
    return res.status(400).json({ error: 'Urgency can only be updated while waiting for supervisor approval.' });
  }

  const { data, error } = await supabase
    .from('expense_requests')
    .update({
      priority: normalizedPriority,
      updated_at: new Date()
    })
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(400).json({ error });

  await insertAuditLogs(id, req.user.id, [
    {
      entity_type: 'request',
      action: 'priority_updated',
      field_name: 'priority',
      old_value: toText(request.priority),
      new_value: normalizedPriority,
      note: 'Urgency updated during supervisor review'
    }
  ]);

  res.json(data);
});

// PATCH /api/requests/:id/approve - Now VP/President only (accounting removed)
router.patch('/:id/approve', authenticate, authorize('supervisor', 'vp', 'president', 'admin'), async (req: any, res) => {
  const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
  const { id } = req.params;
  const { data: request, error: fetchError } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('id', id)
    .single();
  if (fetchError) return res.status(400).json({ error: fetchError });
  if (req.user.role === 'supervisor') {
    const accessibleDepartmentIds = await getAccessibleDepartmentIdsForUser(supabase, req.user, activeFiscalYear);
    if (!accessibleDepartmentIds.includes(request.department_id)) return res.status(403).json({ error: 'Forbidden' });
  }

  if (req.user.role !== 'supervisor') {
    return res.status(400).json({ error: 'Accounting approvals now require release details. Use the release action instead.' });
  }

  if (request.status !== 'pending_supervisor') {
    return res.status(400).json({ error: 'Only requests waiting for supervisor approval can be approved here' });
  }

  const { data, error } = await supabase
    .from('expense_requests')
    .update({ status: 'pending_accounting', updated_at: new Date() })
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(400).json({ error });

  await supabase.from('approval_logs').insert({
    request_id: id,
    actor_id: req.user.id,
    action: 'approved',
    stage: 'supervisor',
    note: req.body.note || ''
  });

  await insertAuditLogs(id, req.user.id, [
    {
      entity_type: 'request',
      action: 'status_changed',
      field_name: 'status',
      old_value: request.status,
      new_value: 'pending_accounting',
      note: 'Supervisor approved request'
    }
  ]);

  await notifyEmployee(request.employee_id, 'Request Approved', `Your request ${request.request_code} has moved to accounting review.`);
  res.json(data);
});

// POST /api/requests/:id/co-approve - VP/President dual authorization
router.post('/:id/co-approve', authenticate, authorize('vp', 'president', 'admin'), async (req: any, res) => {
  const { id } = req.params;
  const { data: request, error: fetchError } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('id', id)
    .single();
  
  if (fetchError || !request) {
    return res.status(404).json({ error: 'Request not found' });
  }
  
  const amount = toNumber(request.amount);
  const userRole = req.user.role;
  
  // Get currency from request metadata or default to PHP
  const currency = request.metadata?.currency || 'PHP';
  
  // Thresholds for each currency (500K)
  const thresholds: Record<string, number> = {
    PHP: 500000,  // ₱500,000
    USD: 500000,  // $500,000
    IDR: 500000   // Rp500,000
  };
  
  const vpThreshold = thresholds[currency] || 500000;
  
  // VP can only approve up to 500K in the request's currency
  if (userRole === 'vp' && amount > vpThreshold) {
    return res.status(403).json({ 
      error: `VP can only approve requests up to ${currency}${vpThreshold.toLocaleString()}. President approval required.` 
    });
  }
  
  // President can approve any amount above 500K
  if (userRole === 'president' && amount <= vpThreshold) {
    return res.status(403).json({ 
      error: `President approval only required for requests above ${currency}${vpThreshold.toLocaleString()}. VP can approve this amount.` 
    });
  }
  
  // Check if request is in pending_accounting status
  if (request.status !== 'pending_accounting') {
    return res.status(400).json({ 
      error: `Cannot co-approve request with status '${request.status}'. Only 'pending_accounting' requests can be co-approved.` 
    });
  }

  // Check if already co-approved
  if (request.co_approved_by) {
    return res.status(400).json({ error: 'Request already co-approved' });
  }
  
  const { data, error } = await supabase
    .from('expense_requests')
    .update({
      co_approved_by: req.user.id,
      co_approved_at: new Date(),
      co_approver_role: userRole,
      updated_at: new Date()
    })
    .eq('id', id)
    .select()
    .single();
  
  if (error) return res.status(400).json({ error });
  
  // Log the co-approval
  await insertAuditLogs(id, req.user.id, [
    {
      entity_type: 'request',
      action: 'co_approved',
      field_name: 'co_approved_by',
      old_value: '',
      new_value: req.user.id,
      note: `Co-approved by ${userRole.toUpperCase()} (${currency})`
    }
  ]);
  
  res.json(data);
});

// PATCH /api/requests/:id/hold - toggle on_hold status (VP/President only)
router.patch('/:id/hold', authenticate, authorize('accounting', 'vp', 'president', 'admin'), async (req: any, res) => {
  const { id } = req.params;
  const { data: request, error: fetchError } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('id', id)
    .single();
  
  if (fetchError || !request) {
    return res.status(404).json({ error: 'Request not found' });
  }
  
  // Only allow putting on_hold if currently pending_accounting
  // or removing on_hold if currently on_hold
  const currentStatus = request.status;
  let newStatus: string;
  
  if (currentStatus === 'pending_accounting') {
    newStatus = 'on_hold';
  } else if (currentStatus === 'on_hold') {
    newStatus = 'pending_accounting';
  } else {
    return res.status(400).json({ 
      error: `Cannot change hold status when request is ${currentStatus}. Only pending_accounting or on_hold requests can be toggled.` 
    });
  }
  
  const { data, error } = await supabase
    .from('expense_requests')
    .update({
      status: newStatus,
      updated_at: new Date(),
      on_hold_at: newStatus === 'on_hold' ? new Date() : null,
      on_hold_by: newStatus === 'on_hold' ? req.user.id : null
    })
    .eq('id', id)
    .select()
    .single();
  
  if (error) return res.status(400).json({ error });
  
  // Log the action
  await insertAuditLogs(id, req.user.id, [
    {
      entity_type: 'request',
      action: 'status_changed',
      field_name: 'status',
      old_value: currentStatus,
      new_value: newStatus,
      note: newStatus === 'on_hold' 
        ? `Request placed on hold by ${req.user.role}`
        : `Request removed from hold by ${req.user.role}`
    }
  ]);
  
  res.json(data);
});

// PATCH /api/requests/:id/release
router.patch('/:id/release', authenticate, authorize('accounting', 'admin'), async (req: any, res) => {
  const { id } = req.params;
  const { data: request, error: fetchError } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('id', id)
    .single();
  if (fetchError || !request) return res.status(400).json({ error: fetchError || 'Request not found.' });

  if (request.status === 'on_hold') {
    return res.status(400).json({ error: 'Cannot release request that is On Hold. Remove from hold first.' });
  }
  if (request.status !== 'pending_accounting') {
    return res.status(400).json({ error: 'Only requests waiting for accounting approval can be released here.' });
  }

  // Check co-approval requirement for amounts >= 500K
  const amount = toNumber(request.amount);
  const currency = request.metadata?.currency || 'PHP';
  const thresholds: Record<string, number> = {
    PHP: 500000,
    USD: 500000,
    IDR: 500000
  };
  const vpThreshold = thresholds[currency] || 500000;
  
  if (amount >= vpThreshold && !request.co_approved_by) {
    return res.status(403).json({ 
      error: `Requests ${currency}${vpThreshold.toLocaleString()} and above require VP/President co-approval before release.` 
    });
  }

  try {
    const released = await releaseRequest(request, req.user.id, req.body || {});
    await notifyEmployee(request.employee_id, 'Request Released', `Your request ${request.request_code} has been released.`);
    res.json(released);
  } catch (releaseError: any) {
    res.status(400).json({ error: releaseError?.message || releaseError });
  }
});

// PATCH /api/requests/:id/return
router.patch('/:id/return', authenticate, authorize('supervisor', 'accounting', 'vp', 'president', 'admin'), async (req: any, res) => {
  const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
  const { id } = req.params;
  const reason = toText(req.body?.reason);
  const { data: request, error: fetchError } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError || !request) return res.status(400).json({ error: fetchError || 'Request not found.' });
  if (req.user.role === 'supervisor') {
    const accessibleDepartmentIds = await getAccessibleDepartmentIdsForUser(supabase, req.user, activeFiscalYear);
    if (!accessibleDepartmentIds.includes(request.department_id)) return res.status(403).json({ error: 'Forbidden' });
  }
  if (!['pending_supervisor', 'pending_accounting'].includes(request.status)) {
    return res.status(400).json({ error: 'Only pending requests can be returned for revision.' });
  }
  if (!reason) {
    return res.status(400).json({ error: 'A return reason is required.' });
  }

  const stage = req.user.role === 'supervisor' ? 'supervisor' : 'accounting';
  const { data, error } = await supabase
    .from('expense_requests')
    .update({
      status: 'returned_for_revision',
      returned_by: req.user.id,
      returned_at: new Date(),
      return_reason: reason,
      updated_at: new Date()
    })
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(400).json({ error });

  await supabase.from('approval_logs').insert({
    request_id: id,
    actor_id: req.user.id,
    action: 'returned',
    stage,
    note: reason
  });

  await insertAuditLogs(id, req.user.id, [
    {
      entity_type: 'request',
      action: 'returned_for_revision',
      field_name: 'status',
      old_value: request.status,
      new_value: 'returned_for_revision',
      note: reason
    }
  ]);


  // Reverse committed_amount for ALL items' categories on return_for_revision
  const { data: returnItemsForRollback } = await supabase
    .from('request_items').select('category_id, amount').eq('request_id', id);

  if (returnItemsForRollback && returnItemsForRollback.length > 0) {
    for (const rItem of returnItemsForRollback) {
      if (!rItem.category_id) continue;
      const { data: catBudget } = await supabase.from('budget_categories').select('committed_amount, remaining_amount').eq('id', rItem.category_id).single();
      if (catBudget) {
        await supabase.from('budget_categories').update({
          committed_amount: Math.max(0, toNumber(catBudget.committed_amount) - toNumber(rItem.amount)),
          remaining_amount: toNumber(catBudget.remaining_amount) + toNumber(rItem.amount),
          updated_at: new Date()
        }).eq('id', rItem.category_id);
      }
    }
  } else if (request.category_id || request.category) {
    const effectiveCategoryId = request.category_id || (await supabase.from('budget_categories').select('id').eq('category_name', String(request.category).trim()).eq('department_id', request.department_id).eq('fiscal_year', request.fiscal_year).maybeSingle()).data?.id;
    if (effectiveCategoryId) {
      const { data: categoryBudget } = await supabase.from('budget_categories').select('committed_amount, remaining_amount').eq('id', effectiveCategoryId).single();
      if (categoryBudget) {
        const requestAmount = toNumber(request.amount);
        await supabase.from('budget_categories').update({
          committed_amount: Math.max(0, toNumber(categoryBudget.committed_amount) - requestAmount),
          remaining_amount: toNumber(categoryBudget.remaining_amount) + requestAmount,
          updated_at: new Date()
        }).eq('id', effectiveCategoryId);
      }
    }
  }

  await notifyEmployee(request.employee_id, 'Request Returned for Revision', `Your request ${request.request_code} was returned for revision: ${reason}`);
  res.json(data);
});

// PATCH /api/requests/:id/resubmit
router.patch('/:id/resubmit', authenticate, authorize('employee', 'manager', 'supervisor', 'accounting'), async (req: any, res) => {
  const { id } = req.params;
  const { 
    item_name, 
    amount, 
    category, 
    priority, 
    purpose, 
    attachments = [] 
  } = req.body || {};

  const normalizedItemName = toText(item_name);
  const normalizedAmount = toNumber(amount);
  const normalizedCategory = toText(category);
  const normalizedPriority = toText(priority).toLowerCase() || 'normal';
  const normalizedPurpose = toText(purpose);
  const normalizedAttachments = normalizeAttachments(attachments);

  const { data: request, error: fetchError } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError || !request) return res.status(400).json({ error: fetchError || 'Request not found.' });
  // Only employee/manager must own the request; supervisor/accounting can resubmit for any employee
  const isTrustedResubmitter = req.user.role === 'supervisor' || req.user.role === 'accounting';
  if (!isTrustedResubmitter && request.employee_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  if (request.status !== 'returned_for_revision') {
    return res.status(400).json({ error: 'Only returned requests can be resubmitted.' });
  }

  const newAmount = normalizedAmount || request.amount;
  // Supervisor/accounting submitters bypass the supervisor stage on resubmit
  const resubmitStatus = (req.user.role === 'supervisor' || req.user.role === 'accounting') ? 'pending_accounting' : 'pending_supervisor';

  const { data, error } = await supabase
    .from('expense_requests')
    .update({
      status: resubmitStatus,
      item_name: normalizedItemName || request.item_name,
      department_id: req.body?.department_id || request.department_id,
      amount: newAmount,
      category: normalizedCategory || request.category,
      priority: normalizedPriority || request.priority,
      purpose: normalizedPurpose || request.purpose,
      submitted_at: new Date(),
      returned_by: null,
      returned_at: null,
      return_reason: null,
      revision_count: Number(request.revision_count || 0) + 1,
      updated_at: new Date()
    })
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(400).json({ error });

  // Update allocation if amount or department changes (assuming single item requests for now)
  // For simplicity, we update the primary allocation to match the new request amount
  const allocationAmount = normalizedAmount !== undefined && normalizedAmount !== null ? normalizedAmount : request.amount;
  await supabase
    .from('request_allocations')
    .update({ 
      amount: allocationAmount,
      updated_at: new Date() 
    })
    .eq('request_id', id)
    .eq('department_id', request.department_id);

  if (normalizedAttachments.length) {
    const { error: attachmentError } = await supabase.from('request_attachments').insert(
      normalizedAttachments.map((attachment) => ({
        request_id: id,
        attachment_scope: attachment.attachment_scope,
        attachment_type: attachment.attachment_type || null,
        file_name: attachment.file_name,
        file_url: attachment.file_url,
        uploaded_by: req.user.id
      }))
    );
    if (attachmentError) return res.status(400).json({ error: attachmentError });
  }

  await supabase.from('approval_logs').insert({
    request_id: id,
    actor_id: req.user.id,
    action: 'submitted',
    stage: resubmitStatus === 'pending_accounting' ? 'accounting' : 'supervisor',
    note: 'Request resubmitted after revision'
  });

  await insertAuditLogs(id, req.user.id, [
    {
      entity_type: 'request',
      action: 'resubmitted',
      field_name: 'status',
      old_value: request.status,
      new_value: resubmitStatus,
      note: 'Request resubmitted after revision'
    },
    ...normalizedAttachments.map((attachment) => ({
      entity_type: 'attachment' as const,
      action: 'attached',
      field_name: attachment.attachment_type || 'supporting_document',
      new_value: attachment.file_name,
      note: attachment.file_url
    }))
  ]);

  // Re-commit budget categories on resubmit (per item if multi-item, else single category)
  const { data: resubmitItems } = await supabase
    .from('request_items').select('category_id, amount').eq('request_id', id);

  if (resubmitItems && resubmitItems.length > 0) {
    // Multi-item: re-commit each item's category
    // If amount changed, scale proportionally
    const originalAmount = toNumber(request.amount);
    const scaleFactor = originalAmount > 0 && toNumber(newAmount) !== originalAmount ? toNumber(newAmount) / originalAmount : 1;
    for (const rItem of resubmitItems) {
      if (!rItem.category_id) continue;
      const { data: catBudget } = await supabase.from('budget_categories').select('committed_amount, remaining_amount').eq('id', rItem.category_id).single();
      if (catBudget) {
        const itemAmt = toNumber(rItem.amount) * scaleFactor;
        await supabase.from('budget_categories').update({
          committed_amount: toNumber(catBudget.committed_amount) + itemAmt,
          remaining_amount: Math.max(0, toNumber(catBudget.remaining_amount) - itemAmt),
          updated_at: new Date()
        }).eq('id', rItem.category_id);
      }
    }
  } else {
    // Single-item fallback
    const effectiveCategoryName = normalizedCategory || request.category;
    const effectiveCategoryId = (await supabase.from('budget_categories').select('id').eq('category_name', String(effectiveCategoryName).trim()).eq('department_id', request.department_id).eq('fiscal_year', request.fiscal_year).maybeSingle()).data?.id;
    if (effectiveCategoryId) {
      const { data: categoryBudget } = await supabase.from('budget_categories').select('committed_amount, remaining_amount').eq('id', effectiveCategoryId).single();
      if (categoryBudget) {
        const resubmitAmount = toNumber(newAmount);
        await supabase.from('budget_categories').update({
          committed_amount: toNumber(categoryBudget.committed_amount) + resubmitAmount,
          remaining_amount: Math.max(0, toNumber(categoryBudget.remaining_amount) - resubmitAmount),
          updated_at: new Date()
        }).eq('id', effectiveCategoryId);
        await supabase.from('expense_requests').update({ category_id: effectiveCategoryId }).eq('id', id);
      }
    }
  }

  res.json((await appendWorkflowDataToRequests([data]))[0]);
});

// PATCH /api/requests/:id/reject
router.patch('/:id/reject', authenticate, authorize('supervisor', 'accounting', 'vp', 'president', 'admin'), async (req: any, res) => {
  const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
  const { id } = req.params;
  const reason = toText(req.body?.reason);
  const { data: request, error: fetchRejectError } = await supabase.from('expense_requests').select('*').eq('id', id).single();
  if (fetchRejectError || !request) return res.status(404).json({ error: 'Request not found.' });
  if (req.user.role === 'supervisor') {
    const accessibleDepartmentIds = await getAccessibleDepartmentIdsForUser(supabase, req.user, activeFiscalYear);
    if (!accessibleDepartmentIds.includes(request.department_id)) return res.status(403).json({ error: 'Forbidden' });
  }
  const stage = req.user.role === 'supervisor' ? 'supervisor' : 'accounting';
  const requestType = request.metadata?.request_type || 'request';
  const typeLabel = requestType.replace(/_/g, ' ').toUpperCase();

  const { data, error } = await supabase
    .from('expense_requests')
    .update({ 
      status: 'rejected', 
      rejection_reason: reason, 
      rejection_stage: stage, 
      archived: true, 
      updated_at: new Date() 
    })
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(400).json({ error });

  await supabase.from('approval_logs').insert({
    request_id: id,
    actor_id: req.user.id,
    action: 'rejected',
    stage,
    note: `[${typeLabel}] ${reason}`
  });

  await insertAuditLogs(id, req.user.id, [
    {
      entity_type: 'request',
      action: 'rejected',
      field_name: 'status',
      old_value: request.status,
      new_value: 'rejected',
      note: `[${typeLabel}] ${reason}`
    },
    {
      entity_type: 'request',
      action: 'archived',
      field_name: 'archived',
      old_value: request.archived ? 'true' : 'false',
      new_value: 'true',
      note: 'Automatically archived after rejection'
    }
  ]);

  await notifyEmployee(request.employee_id, 'Request Rejected', `Your request ${request.request_code} has been rejected: ${reason}`);

  // Reverse committed_amount for ALL items' categories on rejection
  const { data: requestItemsForRollback } = await supabase
    .from('request_items')
    .select('category_id, amount')
    .eq('request_id', id);

  if (requestItemsForRollback && requestItemsForRollback.length > 0) {
    // Multi-item: reverse each item's category committed_amount
    for (const rItem of requestItemsForRollback) {
      if (!rItem.category_id) continue;
      const { data: catBudget } = await supabase.from('budget_categories').select('committed_amount, remaining_amount').eq('id', rItem.category_id).single();
      if (catBudget) {
        const itemAmt = toNumber(rItem.amount);
        await supabase.from('budget_categories').update({
          committed_amount: Math.max(0, toNumber(catBudget.committed_amount) - itemAmt),
          remaining_amount: toNumber(catBudget.remaining_amount) + itemAmt,
          updated_at: new Date()
        }).eq('id', rItem.category_id);
      }
    }
  } else if (request.category_id || request.category) {
    // Single-item fallback
    const effectiveCategoryId = request.category_id || (await supabase.from('budget_categories').select('id').eq('category_name', String(request.category).trim()).eq('department_id', request.department_id).eq('fiscal_year', request.fiscal_year).maybeSingle()).data?.id;
    if (effectiveCategoryId) {
      const { data: categoryBudget } = await supabase.from('budget_categories').select('committed_amount, remaining_amount').eq('id', effectiveCategoryId).single();
      if (categoryBudget) {
        const requestAmount = toNumber(request.amount);
        await supabase.from('budget_categories').update({
          committed_amount: Math.max(0, toNumber(categoryBudget.committed_amount) - requestAmount),
          remaining_amount: toNumber(categoryBudget.remaining_amount) + requestAmount,
          updated_at: new Date()
        }).eq('id', effectiveCategoryId);
      }
    }
  }
  res.json(data);
});


// PATCH /api/requests/:id/liquidation/review
router.patch('/:id/liquidation/review', authenticate, authorize('accounting', 'admin'), async (req: any, res) => {
  const { id } = req.params;
  const status = toText(req.body?.status);
  const remarks = toText(req.body?.remarks);
  if (!['verified', 'returned'].includes(status)) {
    return res.status(400).json({ error: 'Liquidation review status must be verified or returned.' });
  }

  const { data: liquidation, error: liquidationError } = await supabase
    .from('request_liquidations')
    .select('*')
    .eq('request_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (liquidationError || !liquidation) return res.status(400).json({ error: liquidationError || 'Liquidation not found.' });

  const { data, error } = await supabase
    .from('request_liquidations')
    .update({
      status,
      reviewed_at: new Date(),
      reviewed_by: req.user.id,
      remarks: remarks || liquidation.remarks,
      updated_at: new Date()
    })
    .eq('id', liquidation.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error });

  await insertAuditLogs(id, req.user.id, [
    {
      entity_type: 'liquidation',
      action: status === 'verified' ? 'verified' : 'returned',
      field_name: 'status',
      old_value: liquidation.status,
      new_value: status,
      note: remarks || undefined
    }
  ]);

  // Also update the related cash_advances record if it exists
  const { data: cashAdvance } = await supabase
    .from('cash_advances')
    .select('id')
    .eq('request_id', id)
    .maybeSingle();

  if (cashAdvance) {
    let newCAStatus: string;
    if (status === 'verified') {
      // Determine partial vs full liquidation based on remaining balance
      const { data: caRecord } = await supabase
        .from('cash_advances')
        .select('balance')
        .eq('id', cashAdvance.id)
        .single();
      newCAStatus = (caRecord && toNumber(caRecord.balance) <= 0) ? 'fully_liquidated' : 'partially_liquidated';
    } else {
      newCAStatus = 'outstanding';
    }
    await supabase
      .from('cash_advances')
      .update({ 
        status: newCAStatus,
        updated_at: new Date()
      })
      .eq('id', cashAdvance.id);
  }

  res.json(data);
});

// GET /api/requests/:id/timeline
router.get('/:id/timeline', authenticate, async (req: any, res) => {
  const [approvalLogsResult, allocationLogsResult, auditLogsResult, departmentsResult] = await Promise.all([
    supabase.from('approval_logs').select('*').eq('request_id', req.params.id),
    supabase.from('allocation_logs').select('*').eq('request_id', req.params.id),
    supabase.from('request_audit_logs').select('*').eq('request_id', req.params.id),
    supabase.from('departments').select('id, name')
  ]);

  if (approvalLogsResult.error) return res.status(400).json({ error: approvalLogsResult.error });
  if (allocationLogsResult.error) return res.status(400).json({ error: allocationLogsResult.error });
  if (auditLogsResult.error) return res.status(400).json({ error: auditLogsResult.error });

  const departmentMap = new Map((departmentsResult.data || []).map((d: any) => [String(d.id).toLowerCase(), d.name]));
    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

    const resolveNames = (text: any) => {
      if (!text) return text;
      const stringText = String(text);
      return stringText.replace(uuidRegex, (match) => departmentMap.get(match.toLowerCase()) || match);
    };

  const approvalLogs = (approvalLogsResult.data || []).map((log: any) => ({
    ...log,
    note: resolveNames(log.note),
    event_time: log.timestamp,
    approval_side: log.stage === 'supervisor' ? 'supervisor' : ['accounting', 'finance'].includes(log.stage) ? 'accounting' : 'general'
  }));
  const allocationLogs = (allocationLogsResult.data || []).map((log: any) => ({
    ...log,
    note: resolveNames(log.note),
    stage: 'allocation',
    event_time: log.created_at,
    approval_side: 'accounting'
  }));
  const auditLogs = (auditLogsResult.data || []).map((log: any) => ({
    ...log,
    note: resolveNames(log.note),
    old_value: resolveNames(log.old_value),
    new_value: resolveNames(log.new_value),
    stage: log.entity_type,
    event_time: log.created_at,
    approval_side: log.entity_type === 'request' ? 'general' : log.entity_type === 'liquidation' ? 'accounting' : 'general'
  }));

  const combinedLogs = [...approvalLogs, ...allocationLogs, ...auditLogs].sort(
    (left: any, right: any) => new Date(left.event_time).getTime() - new Date(right.event_time).getTime()
  );

  const actorIds = Array.from(new Set(combinedLogs.map((log: any) => log.actor_id).filter(Boolean)));
  const { data: actors } = actorIds.length
    ? await supabase.from('users').select('id, name, role').in('id', actorIds)
    : { data: [] as any[] };
  const actorMap = new Map((actors || []).map((actor: any) => [actor.id, actor]));

  res.json(
    combinedLogs.map((log: any) => ({
      ...log,
      timestamp: log.event_time,
      actor_name: actorMap.get(log.actor_id)?.name || 'System',
      actor_role: actorMap.get(log.actor_id)?.role || ''
    }))
  );
});

// PATCH /api/requests/:id/archive
router.patch('/:id/archive', authenticate, authorize('supervisor', 'accounting', 'admin'), async (req: any, res) => {
  const { id } = req.params;
  const { archived } = req.body;

  if (typeof archived !== 'boolean') {
    return res.status(400).json({ error: 'Archived must be a boolean value.' });
  }

  const { data: request, error: fetchError } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError) return res.status(400).json({ error: fetchError });
  if (!request) return res.status(404).json({ error: 'Request not found.' });

  if (req.user.role === 'supervisor') {
    const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
    const accessibleDepartmentIds = await getAccessibleDepartmentIdsForUser(supabase, req.user, activeFiscalYear);
    if (!accessibleDepartmentIds.includes(request.department_id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }

  // Allow archiving released or rejected requests
  if (!['released', 'rejected'].includes(request.status)) {
    return res.status(400).json({ error: 'Only released or rejected requests can be archived.' });
  }

  const { data, error } = await supabase
    .from('expense_requests')
    .update({
      archived,
      updated_at: new Date()
    })
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(400).json({ error });

  await insertAuditLogs(id, req.user.id, [
    {
      entity_type: 'request',
      action: archived ? 'archived' : 'unarchived',
      field_name: 'archived',
      old_value: request.archived ? 'true' : 'false',
      new_value: archived ? 'true' : 'false',
      note: `Request ${archived ? 'archived' : 'unarchived'} by ${req.user.role}`
    }
  ]);

  res.json(data);
});

// PATCH /api/requests/:id/reconcile - mark request as reconciled
router.patch('/:id/reconcile', authenticate, authorize('accounting', 'admin'), async (req: any, res) => {
  const { id } = req.params;
  const { reconciled, discrepancy_note } = req.body;
  
  const { data: request, error: fetchError } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('id', id)
    .single();
  
  if (fetchError || !request) {
    return res.status(404).json({ error: 'Request not found' });
  }
  
  if (request.status !== 'released') {
    return res.status(400).json({ error: 'Only released requests can be reconciled' });
  }
  
  const { data, error } = await supabase
    .from('expense_requests')
    .update({
      reconciled: Boolean(reconciled),
      discrepancy_note: discrepancy_note || null,
      reconciled_at: reconciled ? new Date() : null,
      reconciled_by: reconciled ? req.user.id : null,
      updated_at: new Date()
    })
    .eq('id', id)
    .select()
    .single();
  
  if (error) return res.status(400).json({ error });
  
  // Log the reconciliation action
  await insertAuditLogs(id, req.user.id, [
    {
      entity_type: 'request',
      action: reconciled ? 'reconciled' : 'unreconciled',
      field_name: 'reconciled',
      old_value: String(!reconciled),
      new_value: String(Boolean(reconciled)),
      note: reconciled
        ? `Request marked as reconciled${discrepancy_note ? ` with note: ${discrepancy_note}` : ''}`
        : 'Reconciliation removed'
    }
  ]);
  
  res.json(data);
});

export default router;
