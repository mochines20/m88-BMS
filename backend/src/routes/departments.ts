import express from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { supabase } from '../utils/supabase';
import { buildDepartmentBudgetSummaryMap, fetchRequestAllocationsByRequestId, isBudgetCommittedStatus, normalizeAllocations } from '../utils/budget';
import { ensureDepartmentsForFiscalYear, toCanonicalDepartmentName } from '../utils/fiscal';

const router = express.Router();

const toNumber = (value: any) => Number.parseFloat(value ?? 0) || 0;
const normalizeDepartmentName = (value: string) => String(value || '').trim();

// GET /api/departments
router.get('/', authenticate, async (_req: any, res) => {
  const { data: departments, error } = await supabase.from('departments').select('*');
  if (error) return res.status(400).json({ error });

  try {
    const { summaryByDepartmentId } = await buildDepartmentBudgetSummaryMap();
    res.json(
      (departments || []).map((department) => {
        const summary = summaryByDepartmentId.get(department.id);
        return {
          ...department,
          used_budget: summary?.used_budget ?? toNumber(department.used_budget),
          pending_supervisor_total: summary?.pending_supervisor_total ?? 0,
          pending_accounting_total: summary?.pending_accounting_total ?? 0,
          projected_committed_total: summary?.projected_committed_total ?? toNumber(department.used_budget),
          projected_remaining_budget: summary?.projected_remaining_budget ?? toNumber(department.annual_budget) - toNumber(department.used_budget),
          remaining_budget: summary?.remaining_budget ?? toNumber(department.annual_budget) - toNumber(department.used_budget)
        };
      })
    );
  } catch (summaryError: any) {
    res.status(400).json({ error: summaryError?.message || summaryError });
  }
});

router.post('/', authenticate, authorize('admin', 'accounting'), async (req, res) => {
  const { name, annual_budget, fiscal_year } = req.body;

  if (!name || !fiscal_year) {
    return res.status(400).json({ error: 'Department name and fiscal year are required' });
  }

  const normalizedName = String(name).trim();
  const normalizedFiscalYear = Number.parseInt(fiscal_year, 10);
  const canonicalDepartmentName = toCanonicalDepartmentName(normalizedName);

  if (!canonicalDepartmentName) {
    return res.status(400).json({ error: 'Department name is required' });
  }

  const { data: existingDepartment, error: existingDepartmentError } = await supabase
    .from('departments')
    .select('id, name, fiscal_year')
    .ilike('name', canonicalDepartmentName)
    .eq('fiscal_year', normalizedFiscalYear)
    .maybeSingle();

  if (existingDepartmentError) return res.status(400).json({ error: existingDepartmentError });
  if (existingDepartment) {
    return res.status(409).json({ error: 'A department with this name and fiscal year already exists.' });
  }

  const yearDepartments = await ensureDepartmentsForFiscalYear(supabase, normalizedFiscalYear, {
    seedName: canonicalDepartmentName,
    seedAnnualBudget: toNumber(annual_budget)
  });
  const createdDepartment = yearDepartments.find((department: any) => String(department.name).trim().toLowerCase() === canonicalDepartmentName.toLowerCase());

  if (!createdDepartment) {
    return res.status(400).json({ error: 'Unable to provision the fiscal year departments.' });
  }

  res.status(201).json({
    ...createdDepartment,
    generated_departments: yearDepartments
  });
});

router.get('/:id/budget-breakdown', authenticate, async (req: any, res) => {
  const departmentId = req.params.id;
  const departmentResult = await supabase
    .from('departments')
    .select('id, name, fiscal_year, annual_budget, used_budget, petty_cash_balance, updated_at, created_at')
    .eq('id', departmentId)
    .single();

  if (departmentResult.error) return res.status(400).json({ error: departmentResult.error });

  const selectedDepartment = departmentResult.data;
  const duplicateDepartmentsResult = await supabase
    .from('departments')
    .select('id, name, fiscal_year, annual_budget, used_budget, petty_cash_balance, updated_at, created_at')
    .ilike('name', normalizeDepartmentName(selectedDepartment.name))
    .eq('fiscal_year', selectedDepartment.fiscal_year)
    .order('updated_at', { ascending: false });

  if (duplicateDepartmentsResult.error) return res.status(400).json({ error: duplicateDepartmentsResult.error });

  const relatedDepartments = duplicateDepartmentsResult.data || [selectedDepartment];
  const relatedDepartmentIds = relatedDepartments.map((department) => department.id);
  const department = relatedDepartments.reduce((current, candidate) => {
    if (toNumber(candidate.used_budget) !== toNumber(current.used_budget)) {
      return toNumber(candidate.used_budget) > toNumber(current.used_budget) ? candidate : current;
    }

    const currentUpdatedAt = new Date(current.updated_at || current.created_at || 0).getTime();
    const candidateUpdatedAt = new Date(candidate.updated_at || candidate.created_at || 0).getTime();
    return candidateUpdatedAt > currentUpdatedAt ? candidate : current;
  }, selectedDepartment);

  const [requestsResult, directExpensesResult, pettyCashResult] = await Promise.all([
    supabase
      .from('expense_requests')
      .select('id, request_code, department_id, item_name, category, amount, priority, status, submitted_at, updated_at')
      .order('submitted_at', { ascending: false }),
    supabase
      .from('direct_expenses')
      .select('id, item_name, category, amount, description, expense_date, created_at')
      .in('department_id', relatedDepartmentIds)
      .order('expense_date', { ascending: false }),
    supabase
      .from('petty_cash_transactions')
      .select('id, type, amount, purpose, reference_request_id, transaction_date, created_at')
      .in('department_id', relatedDepartmentIds)
      .order('transaction_date', { ascending: false })
  ]);

  if (requestsResult.error) return res.status(400).json({ error: requestsResult.error });
  if (directExpensesResult.error) return res.status(400).json({ error: directExpensesResult.error });
  if (pettyCashResult.error) return res.status(400).json({ error: pettyCashResult.error });

  const allRequests = requestsResult.data || [];
  const allocationsByRequestId = await fetchRequestAllocationsByRequestId(allRequests.map((request: any) => request.id));
  const requests = allRequests.filter((request: any) => {
    const allocations = normalizeAllocations(request, allocationsByRequestId.get(request.id) || []);
    return allocations.some((allocation) => relatedDepartmentIds.includes(allocation.department_id));
  });
  const requestsWithDepartmentShare = requests.map((request: any) => {
    const allocations = normalizeAllocations(request, allocationsByRequestId.get(request.id) || []);
    const departmentAllocationAmount = allocations
      .filter((allocation) => relatedDepartmentIds.includes(allocation.department_id))
      .reduce((sum, allocation) => sum + toNumber(allocation.amount), 0);

    return {
      ...request,
      department_allocation_amount: departmentAllocationAmount,
      allocation_count: allocations.length
    };
  });

  const directExpenses = directExpensesResult.data || [];
  const pettyCashTransactions = pettyCashResult.data || [];

  const totals = {
    annual_budget: Math.max(...relatedDepartments.map(entry => toNumber(entry.annual_budget)), 0),
    used_budget: requests
      .filter(request => isBudgetCommittedStatus(request.status))
      .reduce((sum, request) => {
        const allocations = normalizeAllocations(request, allocationsByRequestId.get(request.id) || []);
        return sum + allocations
          .filter((allocation) => relatedDepartmentIds.includes(allocation.department_id))
          .reduce((allocationSum, allocation) => allocationSum + toNumber(allocation.amount), 0);
      }, 0) +
      directExpenses.reduce((sum, expense) => sum + toNumber(expense.amount), 0),
    petty_cash_balance: Math.max(...relatedDepartments.map(entry => toNumber(entry.petty_cash_balance)), 0),
    released_requests_total: requests
      .filter(request => isBudgetCommittedStatus(request.status))
      .reduce((sum, request) => {
        const allocations = normalizeAllocations(request, allocationsByRequestId.get(request.id) || []);
        return sum + allocations
          .filter((allocation) => relatedDepartmentIds.includes(allocation.department_id))
          .reduce((allocationSum, allocation) => allocationSum + toNumber(allocation.amount), 0);
      }, 0),
    pending_supervisor_total: requests
      .filter(request => request.status === 'pending_supervisor')
      .reduce((sum, request) => {
        const allocations = normalizeAllocations(request, allocationsByRequestId.get(request.id) || []);
        return sum + allocations
          .filter((allocation) => relatedDepartmentIds.includes(allocation.department_id))
          .reduce((allocationSum, allocation) => allocationSum + toNumber(allocation.amount), 0);
      }, 0),
    pending_accounting_total: requests
      .filter(request => request.status === 'pending_accounting')
      .reduce((sum, request) => {
        const allocations = normalizeAllocations(request, allocationsByRequestId.get(request.id) || []);
        return sum + allocations
          .filter((allocation) => relatedDepartmentIds.includes(allocation.department_id))
          .reduce((allocationSum, allocation) => allocationSum + toNumber(allocation.amount), 0);
      }, 0),
    rejected_total: requests
      .filter(request => request.status === 'rejected')
      .reduce((sum, request) => sum + toNumber(request.amount), 0),
    direct_expenses_total: directExpenses.reduce((sum, expense) => sum + toNumber(expense.amount), 0),
    petty_cash_disbursed_total: pettyCashTransactions
      .filter(transaction => transaction.type === 'disbursement')
      .reduce((sum, transaction) => sum + toNumber(transaction.amount), 0),
    petty_cash_replenished_total: pettyCashTransactions
      .filter(transaction => transaction.type === 'replenishment')
      .reduce((sum, transaction) => sum + toNumber(transaction.amount), 0)
  };

  const breakdownTotal = totals.released_requests_total + totals.direct_expenses_total;
  const remainingBudget = totals.annual_budget - totals.used_budget;
  const committedBudget = totals.used_budget + totals.pending_supervisor_total + totals.pending_accounting_total;

  res.json({
    department: {
      ...department,
      annual_budget: totals.annual_budget,
      used_budget: totals.used_budget,
      petty_cash_balance: totals.petty_cash_balance,
      remaining_budget: remainingBudget,
      utilization_percentage: totals.annual_budget > 0 ? (totals.used_budget / totals.annual_budget) * 100 : 0,
      projected_committed_total: committedBudget,
      projected_remaining_budget: totals.annual_budget - committedBudget,
      breakdown_variance: totals.used_budget - breakdownTotal
    },
    totals,
    counts: {
      total_requests: requestsWithDepartmentShare.length,
      released_requests: requestsWithDepartmentShare.filter(request => isBudgetCommittedStatus(request.status)).length,
      pending_supervisor: requestsWithDepartmentShare.filter(request => request.status === 'pending_supervisor').length,
      pending_accounting: requestsWithDepartmentShare.filter(request => request.status === 'pending_accounting').length,
      rejected_requests: requestsWithDepartmentShare.filter(request => request.status === 'rejected').length,
      direct_expenses: directExpenses.length,
      petty_cash_transactions: pettyCashTransactions.length
    },
    recent_requests: requestsWithDepartmentShare.slice(0, 8),
    recent_direct_expenses: directExpenses.slice(0, 8),
    recent_petty_cash_transactions: pettyCashTransactions.slice(0, 8),
    generated_at: new Date().toISOString()
  });
});

router.get('/:id/budget', authenticate, async (req: any, res) => {
  const { data, error } = await supabase
    .from('departments')
    .select('id, name, annual_budget, used_budget, petty_cash_balance')
    .eq('id', req.params.id)
    .single();
  if (error) return res.status(400).json({ error });
  res.json(data);
});

router.patch('/:id/budget', authenticate, authorize('admin', 'accounting'), async (req, res) => {
  const { annual_budget } = req.body;
  const { data, error } = await supabase
    .from('departments')
    .update({ annual_budget, updated_at: new Date() })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(400).json({ error });
  res.json(data);
});

export default router;
