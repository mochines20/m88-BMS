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
const REQUEST_RELATIONS_SELECT = `
  *,
  users:users!fk_expense_requests_employee_id(name),
  departments:departments!fk_expense_requests_department_id(name, fiscal_year)
`;

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
    res.json(enrichRequests(data || [], summaryByDepartmentId, allocationsByRequestId));
  } catch (summaryError: any) {
    res.status(400).json({ error: summaryError?.message || summaryError });
  }
});

// POST /api/requests - submit new
router.post('/', authenticate, authorize('employee'), async (req: any, res) => {
  const { item_name, category, amount, purpose, priority } = req.body;
  const request_code = `REQ-${Date.now()}`;
  const { data, error } = await supabase
    .from('expense_requests')
    .insert({
      request_code,
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

  await supabase.from('approval_logs').insert({
    request_id: data.id,
    actor_id: req.user.id,
    action: 'submitted',
    stage: 'supervisor',
    note: 'Request submitted'
  });

  const { data: supervisor } = await supabase.from('users').select('email').eq('department_id', req.user.department_id).eq('role', 'supervisor').single();
  if (supervisor) sendEmail(supervisor.email, 'New Expense Request', `New request ${request_code} submitted.`);

  res.json(data);
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
    res.json(enrichRequests([data], summaryByDepartmentId, allocationsByRequestId)[0]);
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

  let newStatus = '';
  let stage = '';

  if (req.user.role === 'supervisor') {
    if (request.status !== 'pending_supervisor') {
      return res.status(400).json({ error: 'Only requests waiting for supervisor approval can be approved here' });
    }

    newStatus = 'pending_accounting';
    stage = 'accounting';
  } else if (req.user.role === 'accounting') {
    if (request.status !== 'pending_accounting') {
      return res.status(400).json({ error: 'Only requests waiting for accounting approval can be released here' });
    }

    const allocationsByRequestId = await fetchRequestAllocationsByRequestId([request.id]);
    const normalizedAllocations = normalizeAllocations(request, allocationsByRequestId.get(request.id) || []);
    if (!allocationTotalsMatchRequest(request.amount, normalizedAllocations)) {
      return res.status(400).json({ error: 'Finalize the department allocations before release. The allocated total must match the request amount.' });
    }

    const { summaryByDepartmentId } = await buildDepartmentBudgetSummaryMap();
    const insufficientDepartment = normalizedAllocations.find((allocation) => {
      const summary = summaryByDepartmentId.get(allocation.department_id);
      return !summary || summary.projected_remaining_budget < 0;
    });

    if (insufficientDepartment) {
      const summary = summaryByDepartmentId.get(insufficientDepartment.department_id);
      return res.status(400).json({
        error: `Insufficient projected budget for ${summary?.department_name || 'the selected department'}.`
      });
    }

    for (const allocation of normalizedAllocations) {
      const { data: department, error: departmentError } = await supabase
        .from('departments')
        .select('id, used_budget')
        .eq('id', allocation.department_id)
        .single();
      if (departmentError || !department) {
        return res.status(400).json({ error: departmentError?.message || 'Department not found.' });
      }

      const { error: updateDepartmentError } = await supabase
        .from('departments')
        .update({
          used_budget: toNumber(department.used_budget) + toNumber(allocation.amount),
          updated_at: new Date()
        })
        .eq('id', allocation.department_id);
      if (updateDepartmentError) return res.status(400).json({ error: updateDepartmentError });
    }

    newStatus = 'released';
    stage = 'finance';

    await supabase.from('allocation_logs').insert({
      request_id: request.id,
      actor_id: req.user.id,
      action: 'released',
      note: `Released with ${normalizedAllocations.length} department allocation(s).`
    });
  }

  const { data, error } = await supabase
    .from('expense_requests')
    .update({ status: newStatus, updated_at: new Date() })
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(400).json({ error });

  await supabase.from('approval_logs').insert({
    request_id: id,
    actor_id: req.user.id,
    action: 'approved',
    stage,
    note: req.body.note || ''
  });

  const { data: employee } = await supabase.from('users').select('email').eq('id', request.employee_id).single();
  if (employee) sendEmail(employee.email, 'Request Approved', `Your request ${request.request_code} has been approved.`);
  res.json(data);
});

// PATCH /api/requests/:id/reject
router.patch('/:id/reject', authenticate, authorize('supervisor', 'accounting'), async (req: any, res) => {
  const { id } = req.params;
  const { reason } = req.body;
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

  const { data: employee } = await supabase.from('users').select('email').eq('id', request.employee_id).single();
  if (employee) sendEmail(employee.email, 'Request Rejected', `Your request ${request.request_code} has been rejected: ${reason}`);
  res.json(data);
});

// GET /api/requests/:id/timeline
router.get('/:id/timeline', authenticate, async (req: any, res) => {
  const [approvalLogsResult, allocationLogsResult] = await Promise.all([
    supabase
      .from('approval_logs')
      .select('*')
      .eq('request_id', req.params.id),
    supabase
      .from('allocation_logs')
      .select('*')
      .eq('request_id', req.params.id)
  ]);

  if (approvalLogsResult.error) return res.status(400).json({ error: approvalLogsResult.error });
  if (allocationLogsResult.error) return res.status(400).json({ error: allocationLogsResult.error });

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

  const combinedLogs = [...approvalLogs, ...allocationLogs].sort(
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
