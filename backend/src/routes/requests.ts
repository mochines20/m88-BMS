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

  await insertAuditLogs(request.id, actorId, [
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
  ]);

  return data;
};

const notifyEmployee = async (employeeId: string, subject: string, message: string) => {
  const { data: employee } = await supabase.from('users').select('email').eq('id', employeeId).single();
  if (employee?.email) {
    sendEmail(employee.email, subject, message);
  }
};

// GET /api/requests - list filtered by role/dept
router.get('/', authenticate, async (req: any, res) => {
  const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
  let query = supabase.from('expense_requests').select(REQUEST_RELATIONS_SELECT);
  if (req.user.role === 'employee') {
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
  const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
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
router.post('/', authenticate, authorize('employee', 'supervisor', 'accounting'), async (req: any, res) => {
  const { item_name, category, amount, purpose, priority, attachments = [], metadata = {} } = req.body;
  const request_code = `REQ-${Date.now()}`;
  const activeDepartment = { id: req.user.department_id, fiscal_year: await getLatestConfiguredFiscalYear(supabase) };
  const normalizedAttachments = normalizeAttachments(attachments);
  
  // Determine initial status based on user role
  // Employee -> pending_supervisor, Supervisor/Accounting -> pending_accounting (skip supervisor)
  const userRole = req.user.role;
  const initialStatus = userRole === 'employee' ? 'pending_supervisor' : 'pending_accounting';
  
  const { data, error } = await supabase
    .from('expense_requests')
    .insert({
      request_code: request_code,
      employee_id: req.user.id,
      department_id: activeDepartment.id,
      fiscal_year: activeDepartment.fiscal_year,
      item_name,
      category,
      amount,
      purpose,
      priority,
      status: initialStatus,
      submitted_at: new Date(),
      metadata
    })
    .select()
    .single();
  if (error || !data) return res.status(400).json({ error: error || 'Failed to create request' });

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
    stage: userRole === 'employee' ? 'supervisor' : 'accounting',
    note: userRole === 'employee' ? 'Request submitted' : `Request submitted by ${userRole} (routed directly to accounting)`
  });

  // Notify based on role
  if (userRole === 'employee') {
    // Notify supervisor
    const { data: supervisor } = await supabase.from('users').select('email').eq('department_id', req.user.department_id).eq('role', 'supervisor').single();
    if (supervisor?.email) sendEmail(supervisor.email, 'New Expense Request', `New request ${request_code} submitted.`);
  } else {
    // Notify accounting staff
    const { data: accountingStaff } = await supabase.from('users').select('email').eq('role', 'accounting');
    if (accountingStaff) {
      for (const accountant of accountingStaff) {
        if (accountant.email) {
          sendEmail(accountant.email, 'New Direct Request', `New direct request from ${userRole} ${req.user.name || req.user.email}: ${request_code} requires accounting review.`);
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

// GET /api/requests/:id
router.get('/:id', authenticate, async (req: any, res) => {
  const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
  const { data, error } = await supabase
    .from('expense_requests')
    .select(REQUEST_RELATIONS_SELECT)
    .eq('id', req.params.id)
    .single();
  if (error) return res.status(400).json({ error });
  if (req.user.role === 'employee' && data.employee_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
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

// PATCH /api/requests/:id/approve
router.patch('/:id/approve', authenticate, authorize('supervisor', 'accounting'), async (req: any, res) => {
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
    stage: 'accounting',
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

// PATCH /api/requests/:id/hold - toggle on_hold status (accounting only)
router.patch('/:id/hold', authenticate, authorize('accounting', 'admin'), async (req: any, res) => {
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
        ? 'Request placed on hold by accounting'
        : 'Request removed from hold by accounting'
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

  try {
    const released = await releaseRequest(request, req.user.id, req.body || {});
    await notifyEmployee(request.employee_id, 'Request Released', `Your request ${request.request_code} has been released.`);
    res.json(released);
  } catch (releaseError: any) {
    res.status(400).json({ error: releaseError?.message || releaseError });
  }
});

// PATCH /api/requests/:id/return
router.patch('/:id/return', authenticate, authorize('supervisor', 'accounting', 'admin'), async (req: any, res) => {
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

  await notifyEmployee(request.employee_id, 'Request Returned for Revision', `Your request ${request.request_code} was returned for revision: ${reason}`);
  res.json(data);
});

// PATCH /api/requests/:id/resubmit
router.patch('/:id/resubmit', authenticate, authorize('employee'), async (req: any, res) => {
  const { id } = req.params;
  const { 
    item_name, 
    amount, 
    category, 
    priority, 
    purpose, 
    attachments = [] 
  } = req.body || {};

  // DEBUG LOGGING
  console.log('RESUBMIT DEBUG - Raw body:', req.body);
  console.log('RESUBMIT DEBUG - amount value:', amount, 'type:', typeof amount);

  const normalizedItemName = toText(item_name);
  const normalizedAmount = toNumber(amount);
  const normalizedCategory = toText(category);
  const normalizedPriority = toText(priority).toLowerCase() || 'normal';
  const normalizedPurpose = toText(purpose);
  const normalizedAttachments = normalizeAttachments(attachments);

  console.log('RESUBMIT DEBUG - normalizedAmount:', normalizedAmount);

  const { data: request, error: fetchError } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError || !request) return res.status(400).json({ error: fetchError || 'Request not found.' });
  if (request.employee_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  if (request.status !== 'returned_for_revision') {
    return res.status(400).json({ error: 'Only returned requests can be resubmitted.' });
  }

  const newAmount = normalizedAmount !== undefined && normalizedAmount !== null ? normalizedAmount : request.amount;
  console.log('RESUBMIT DEBUG - About to update with newAmount:', newAmount, 'old amount:', request.amount);

  const { data, error } = await supabase
    .from('expense_requests')
    .update({
      status: 'pending_supervisor',
      item_name: normalizedItemName || request.item_name,
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

  console.log('RESUBMIT DEBUG - Updated request amount:', data?.amount);

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
    stage: 'supervisor',
    note: 'Request resubmitted after revision'
  });

  await insertAuditLogs(id, req.user.id, [
    {
      entity_type: 'request',
      action: 'resubmitted',
      field_name: 'status',
      old_value: request.status,
      new_value: 'pending_supervisor',
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

  res.json((await appendWorkflowDataToRequests([data]))[0]);
});

// PATCH /api/requests/:id/reject
router.patch('/:id/reject', authenticate, authorize('supervisor', 'accounting'), async (req: any, res) => {
  const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
  const { id } = req.params;
  const reason = toText(req.body?.reason);
  const { data: request } = await supabase.from('expense_requests').select('*').eq('id', id).single();
  if (req.user.role === 'supervisor') {
    const accessibleDepartmentIds = await getAccessibleDepartmentIdsForUser(supabase, req.user, activeFiscalYear);
    if (!accessibleDepartmentIds.includes(request.department_id)) return res.status(403).json({ error: 'Forbidden' });
  }
  const stage = req.user.role === 'supervisor' ? 'supervisor' : 'accounting';
  const { data, error } = await supabase
    .from('expense_requests')
    .update({ status: 'rejected', rejection_reason: reason, rejection_stage: stage, archived: true, updated_at: new Date() })
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(400).json({ error });

  await supabase.from('approval_logs').insert({
    request_id: id,
    actor_id: req.user.id,
    action: 'rejected',
    stage,
    note: reason
  });

  await insertAuditLogs(id, req.user.id, [
    {
      entity_type: 'request',
      action: 'status_changed',
      field_name: 'status',
      old_value: request.status,
      new_value: 'rejected',
      note: reason
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
  res.json(data);
});

// PATCH /api/requests/:id/liquidation
router.patch('/:id/liquidation', authenticate, authorize('employee'), async (req: any, res) => {
  const { id } = req.params;
  const actualAmount = toNumber(req.body?.actual_amount);
  const remarks = toText(req.body?.remarks);
  const attachmentUrl = toText(req.body?.attachment_url);
  const { data: request, error: requestError } = await supabase.from('expense_requests').select('*').eq('id', id).single();

  if (requestError || !request) return res.status(400).json({ error: requestError || 'Request not found.' });
  if (request.employee_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  if (request.status !== 'released') return res.status(400).json({ error: 'Liquidation can only be submitted after release.' });
  if (actualAmount <= 0) return res.status(400).json({ error: 'Actual liquidation amount must be greater than zero.' });

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
        shortage_amount: 0,
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
        shortage_amount: 0,
        remarks,
        created_by: req.user.id,
        created_at: new Date(),
        updated_at: new Date()
      })
      .select()
      .single();
  }

  if (result.error) return res.status(400).json({ error: result.error });

  // Handle attachment if provided
  if (attachmentUrl) {
    await supabase.from('request_attachments').insert({
      request_id: id,
      liquidation_id: result.data.id,
      attachment_scope: 'liquidation',
      attachment_type: 'receipt',
      file_name: `liquidation-receipt-${result.data.liquidation_no}.png`,
      file_url: attachmentUrl,
      uploaded_by: req.user.id,
      uploaded_at: new Date()
    });
  }

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

  res.json(result.data);
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
  await supabase.from('request_audit_logs').insert({
    request_id: id,
    action: reconciled ? 'reconciled' : 'unreconciled',
    actor_id: req.user.id,
    actor_name: req.user.name || req.user.email,
    actor_role: req.user.role,
    details: reconciled 
      ? `Request marked as reconciled${discrepancy_note ? ` with note: ${discrepancy_note}` : ''}`
      : 'Reconciliation removed',
    created_at: new Date()
  });
  
  res.json(data);
});

export default router;
