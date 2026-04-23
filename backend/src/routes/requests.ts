import express from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { supabase } from '../utils/supabase';
import { sendEmail } from '../utils/email';
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
      .select('id, used_budget')
      .eq('id', allocation.department_id)
      .single();

    if (departmentError || !department) {
      throw new Error(departmentError?.message || 'Department not found.');
    }

    const { error: updateDepartmentError } = await supabase
      .from('departments')
      .update({
        used_budget: toNumber(department.used_budget) + toNumber(allocation.amount),
        updated_at: new Date()
      })
      .eq('id', allocation.department_id);

    if (updateDepartmentError) {
      throw updateDepartmentError;
    }
  }

  const releaseMethod = ['cash', 'bank_transfer', 'check', 'petty_cash', 'other'].includes(toText(payload.release_method))
    ? toText(payload.release_method)
    : 'other';
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
  let query = supabase.from('expense_requests').select(REQUEST_RELATIONS_SELECT);
  if (req.user.role === 'employee') {
    query = query.eq('employee_id', req.user.id);
  } else if (req.user.role === 'supervisor') {
    query = query.eq('department_id', req.user.department_id);
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

// POST /api/requests - submit new
router.post('/', authenticate, authorize('employee'), async (req: any, res) => {
  const { item_name, category, amount, purpose, priority, attachments = [] } = req.body;
  const requestCode = `REQ-${Date.now()}`;
  const normalizedAttachments = normalizeAttachments(attachments);

  const { data, error } = await supabase
    .from('expense_requests')
    .insert({
      request_code: requestCode,
      employee_id: req.user.id,
      department_id: req.user.department_id,
      item_name,
      category,
      amount,
      purpose,
      priority,
      status: 'pending_supervisor',
      submitted_at: new Date()
    })
    .select()
    .single();
  if (error) return res.status(400).json({ error });

  if (normalizedAttachments.length) {
    const { error: attachmentError } = await supabase.from('request_attachments').insert(
      normalizedAttachments.map((attachment) => ({
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
    stage: 'supervisor',
    note: 'Request submitted'
  });

  await insertAuditLogs(data.id, req.user.id, [
    {
      entity_type: 'request',
      action: 'created',
      note: 'Expense request submitted'
    },
    ...normalizedAttachments.map((attachment) => ({
      entity_type: 'attachment' as const,
      action: 'attached',
      field_name: attachment.attachment_type || 'supporting_document',
      new_value: attachment.file_name,
      note: attachment.file_url
    }))
  ]);

  const { data: supervisor } = await supabase
    .from('users')
    .select('email')
    .eq('department_id', req.user.department_id)
    .eq('role', 'supervisor')
    .single();
  if (supervisor) sendEmail(supervisor.email, 'New Expense Request', `New request ${requestCode} submitted.`);

  const responseRows = await appendWorkflowDataToRequests([{ ...data, attachments: normalizedAttachments }]);
  res.json(responseRows[0]);
});

// GET /api/requests/:id
router.get('/:id', authenticate, async (req: any, res) => {
  const { data, error } = await supabase
    .from('expense_requests')
    .select(REQUEST_RELATIONS_SELECT)
    .eq('id', req.params.id)
    .single();
  if (error) return res.status(400).json({ error });
  if (req.user.role === 'employee' && data.employee_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  if (req.user.role === 'supervisor' && data.department_id !== req.user.department_id) return res.status(403).json({ error: 'Forbidden' });

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
    .select('id, department_id, amount')
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
    .select('id, request_id, department_id, amount');

  if (insertError) return res.status(400).json({ error: insertError });

  const oldSummary = (existingAllocations || []).map((allocation) => `${allocation.department_id}:${toNumber(allocation.amount).toFixed(2)}`).join(', ') || 'none';
  const newSummary = (savedAllocations || []).map((allocation) => `${allocation.department_id}:${toNumber(allocation.amount).toFixed(2)}`).join(', ');

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

  res.json(savedAllocations || []);
});

// PATCH /api/requests/:id/approve
router.patch('/:id/approve', authenticate, authorize('supervisor', 'accounting'), async (req: any, res) => {
  const { id } = req.params;
  const { data: request, error: fetchError } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('id', id)
    .single();
  if (fetchError) return res.status(400).json({ error: fetchError });
  if (req.user.role === 'supervisor' && request.department_id !== req.user.department_id) return res.status(403).json({ error: 'Forbidden' });

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

// PATCH /api/requests/:id/release
router.patch('/:id/release', authenticate, authorize('accounting', 'admin'), async (req: any, res) => {
  const { id } = req.params;
  const { data: request, error: fetchError } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('id', id)
    .single();
  if (fetchError || !request) return res.status(400).json({ error: fetchError || 'Request not found.' });

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
  const { id } = req.params;
  const reason = toText(req.body?.reason);
  const { data: request, error: fetchError } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError || !request) return res.status(400).json({ error: fetchError || 'Request not found.' });
  if (req.user.role === 'supervisor' && request.department_id !== req.user.department_id) return res.status(403).json({ error: 'Forbidden' });
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
  const { purpose, attachments = [] } = req.body || {};
  const normalizedPurpose = toText(purpose);
  const normalizedAttachments = normalizeAttachments(attachments);
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

  const { data, error } = await supabase
    .from('expense_requests')
    .update({
      status: 'pending_supervisor',
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
  const { id } = req.params;
  const reason = toText(req.body?.reason);
  const { data: request } = await supabase.from('expense_requests').select('*').eq('id', id).single();
  if (req.user.role === 'supervisor' && request.department_id !== req.user.department_id) return res.status(403).json({ error: 'Forbidden' });
  const stage = req.user.role === 'supervisor' ? 'supervisor' : 'accounting';
  const { data, error } = await supabase
    .from('expense_requests')
    .update({ status: 'rejected', rejection_reason: reason, rejection_stage: stage, updated_at: new Date() })
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
  const [approvalLogsResult, allocationLogsResult, auditLogsResult] = await Promise.all([
    supabase.from('approval_logs').select('*').eq('request_id', req.params.id),
    supabase.from('allocation_logs').select('*').eq('request_id', req.params.id),
    supabase.from('request_audit_logs').select('*').eq('request_id', req.params.id)
  ]);

  if (approvalLogsResult.error) return res.status(400).json({ error: approvalLogsResult.error });
  if (allocationLogsResult.error) return res.status(400).json({ error: allocationLogsResult.error });
  if (auditLogsResult.error) return res.status(400).json({ error: auditLogsResult.error });

  const approvalLogs = (approvalLogsResult.data || []).map((log: any) => ({
    ...log,
    event_time: log.timestamp,
    approval_side: log.stage === 'supervisor' ? 'supervisor' : ['accounting', 'finance'].includes(log.stage) ? 'accounting' : 'general'
  }));
  const allocationLogs = (allocationLogsResult.data || []).map((log: any) => ({
    ...log,
    stage: 'allocation',
    event_time: log.created_at,
    approval_side: 'accounting'
  }));
  const auditLogs = (auditLogsResult.data || []).map((log: any) => ({
    ...log,
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

export default router;
