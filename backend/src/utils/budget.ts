import { supabase } from './supabase';

const toNumber = (value: unknown) => Number.parseFloat(String(value ?? 0)) || 0;
const normalizeDepartmentName = (value: string) => String(value || '').trim();
const getDepartmentGroupKey = (department: { name?: string; fiscal_year?: number }) =>
  `${normalizeDepartmentName(department.name || '').toLowerCase()}::${department.fiscal_year ?? ''}`;

export const isBudgetCommittedStatus = (status?: string) => status === 'released' || status === 'approved';
export const isPendingBudgetStatus = (status?: string) => status === 'pending_supervisor' || status === 'pending_accounting';

export interface RequestAllocationRow {
  id?: string;
  request_id: string;
  department_id: string;
  amount: number | string;
  departments?: {
    name?: string;
    fiscal_year?: number;
  } | null;
}

interface ExpenseRequestRow {
  id: string;
  department_id: string;
  amount: number | string;
  status?: string;
}

interface DepartmentBudgetSummary {
  department_name: string;
  fiscal_year: number | null;
  annual_budget: number;
  used_budget: number;
  petty_cash_balance: number;
  direct_expenses_total: number;
  pending_supervisor_total: number;
  pending_accounting_total: number;
  projected_committed_total: number;
  remaining_budget: number;
  projected_remaining_budget: number;
}

export const fetchRequestAllocationsByRequestId = async (requestIds: string[]) => {
  if (!requestIds.length) {
    return new Map<string, RequestAllocationRow[]>();
  }

  const { data, error } = await supabase
    .from('request_allocations')
    .select('id, request_id, department_id, amount, departments(name, fiscal_year)')
    .in('request_id', requestIds);

  if (error) {
    throw error;
  }

  const allocationMap = new Map<string, RequestAllocationRow[]>();
  (data || []).forEach((allocation: any) => {
    const existing = allocationMap.get(allocation.request_id) || [];
    existing.push(allocation);
    allocationMap.set(allocation.request_id, existing);
  });

  return allocationMap;
};

const getRequestBudgetImpacts = (
  request: ExpenseRequestRow,
  allocationsByRequestId: Map<string, RequestAllocationRow[]>
) => {
  const allocations = allocationsByRequestId.get(request.id) || [];
  if (request.status === 'pending_supervisor') {
    return [{ department_id: request.department_id, amount: toNumber(request.amount) }];
  }

  if (allocations.length > 0) {
    return allocations.map((allocation) => ({
      department_id: allocation.department_id,
      amount: toNumber(allocation.amount)
    }));
  }

  return [{ department_id: request.department_id, amount: toNumber(request.amount) }];
};

export const buildDepartmentBudgetSummaryMap = async () => {
  const [departmentsResult, requestsResult, directExpensesResult] = await Promise.all([
    supabase
      .from('departments')
      .select('id, name, fiscal_year, annual_budget, used_budget, petty_cash_balance, updated_at, created_at'),
    supabase.from('expense_requests').select('id, department_id, amount, status'),
    supabase.from('direct_expenses').select('department_id, amount')
  ]);

  if (departmentsResult.error) throw departmentsResult.error;
  if (requestsResult.error) throw requestsResult.error;
  if (directExpensesResult.error) throw directExpensesResult.error;

  const departments = departmentsResult.data || [];
  const requests = (requestsResult.data || []) as ExpenseRequestRow[];
  const directExpenses = directExpensesResult.data || [];
  const allocationsByRequestId = await fetchRequestAllocationsByRequestId(requests.map((request) => request.id));

  const groupedDepartmentIds = new Map<string, string[]>();
  departments.forEach((department) => {
    const key = getDepartmentGroupKey(department);
    const existing = groupedDepartmentIds.get(key) || [];
    existing.push(department.id);
    groupedDepartmentIds.set(key, existing);
  });

  const totalsByDepartmentId = new Map<
    string,
    {
      released: number;
      pendingSupervisor: number;
      pendingAccounting: number;
    }
  >();

  requests.forEach((request) => {
    const impacts = getRequestBudgetImpacts(request, allocationsByRequestId);
    impacts.forEach((impact) => {
      const current = totalsByDepartmentId.get(impact.department_id) || {
        released: 0,
        pendingSupervisor: 0,
        pendingAccounting: 0
      };

      if (request.status === 'pending_supervisor') {
        current.pendingSupervisor += impact.amount;
      } else if (request.status === 'pending_accounting') {
        current.pendingAccounting += impact.amount;
      } else if (isBudgetCommittedStatus(request.status)) {
        current.released += impact.amount;
      }

      totalsByDepartmentId.set(impact.department_id, current);
    });
  });

  const summariesByGroup = new Map<string, DepartmentBudgetSummary>();
  groupedDepartmentIds.forEach((ids, key) => {
    const groupedDepartments = departments.filter((department) => ids.includes(department.id));
    const annualBudget = Math.max(...groupedDepartments.map((entry) => toNumber(entry.annual_budget)), 0);
    const pettyCashBalance = Math.max(...groupedDepartments.map((entry) => toNumber(entry.petty_cash_balance)), 0);
    const directExpensesTotal = directExpenses
      .filter((expense: any) => ids.includes(expense.department_id))
      .reduce((sum: number, expense: any) => sum + toNumber(expense.amount), 0);
    const releasedRequestsTotal = ids.reduce((sum, id) => sum + (totalsByDepartmentId.get(id)?.released || 0), 0);
    const pendingSupervisorTotal = ids.reduce((sum, id) => sum + (totalsByDepartmentId.get(id)?.pendingSupervisor || 0), 0);
    const pendingAccountingTotal = ids.reduce((sum, id) => sum + (totalsByDepartmentId.get(id)?.pendingAccounting || 0), 0);
    const usedBudget = releasedRequestsTotal + directExpensesTotal;
    const projectedCommittedTotal = usedBudget + pendingSupervisorTotal + pendingAccountingTotal;
    const currentDepartment =
      groupedDepartments.sort((left, right) => {
        const leftUpdatedAt = new Date(String(left.updated_at || left.created_at || 0)).getTime();
        const rightUpdatedAt = new Date(String(right.updated_at || right.created_at || 0)).getTime();
        return rightUpdatedAt - leftUpdatedAt;
      })[0] || null;

    summariesByGroup.set(key, {
      department_name: currentDepartment?.name || 'Unknown department',
      fiscal_year: currentDepartment?.fiscal_year ?? null,
      annual_budget: annualBudget,
      used_budget: usedBudget,
      petty_cash_balance: pettyCashBalance,
      direct_expenses_total: directExpensesTotal,
      pending_supervisor_total: pendingSupervisorTotal,
      pending_accounting_total: pendingAccountingTotal,
      projected_committed_total: projectedCommittedTotal,
      remaining_budget: annualBudget - usedBudget,
      projected_remaining_budget: annualBudget - projectedCommittedTotal
    });
  });

  const summaryByDepartmentId = new Map<string, DepartmentBudgetSummary>();
  departments.forEach((department) => {
    summaryByDepartmentId.set(department.id, summariesByGroup.get(getDepartmentGroupKey(department)) as DepartmentBudgetSummary);
  });

  return {
    summaryByDepartmentId,
    allocationsByRequestId
  };
};

export const enrichRequests = (
  rows: any[],
  budgetSummaryMap: Map<string, DepartmentBudgetSummary>,
  allocationsByRequestId: Map<string, RequestAllocationRow[]>
) =>
  rows.map((row) => {
    const amount = toNumber(row.amount);
    const requestFallbackSummary = budgetSummaryMap.get(row.department_id) || null;
    const sourceAllocations = allocationsByRequestId.get(row.id) || [];
    const fallbackAllocation = sourceAllocations.length
      ? sourceAllocations
      : [{ request_id: row.id, department_id: row.department_id, amount }];

    const allocations = fallbackAllocation.map((allocation) => {
      const departmentSummary = budgetSummaryMap.get(allocation.department_id) || requestFallbackSummary;
      const allocationAmount = toNumber(allocation.amount);

      return {
        ...allocation,
        amount: allocationAmount,
        department_name: departmentSummary?.department_name || 'Unknown department',
        annual_budget: departmentSummary?.annual_budget ?? 0,
        used_budget: departmentSummary?.used_budget ?? 0,
        remaining_budget: departmentSummary?.remaining_budget ?? 0,
        projected_remaining_budget: departmentSummary?.projected_remaining_budget ?? 0,
        projected_remaining_after_approval: departmentSummary
          ? departmentSummary.remaining_budget - allocationAmount
          : 0
      };
    });

    const totalProjectedAfterApproval = allocations.reduce((sum, allocation) => sum + allocation.amount, 0);

    return {
      ...row,
      requester_name: row.users?.name || 'Unknown requester',
      department_name: requestFallbackSummary?.department_name || row.departments?.name || 'Unknown department',
      allocations,
      budget_summary: requestFallbackSummary
        ? {
            ...requestFallbackSummary,
            request_amount: amount,
            projected_used_after_approval: requestFallbackSummary.used_budget + totalProjectedAfterApproval,
            projected_remaining_after_approval: requestFallbackSummary.remaining_budget - totalProjectedAfterApproval
          }
        : null
    };
  });

export const normalizeAllocations = (request: { department_id: string; amount: number | string }, allocations: any[]) => {
  const source = allocations.length
    ? allocations
    : [{ department_id: request.department_id, amount: request.amount }];

  const merged = new Map<string, number>();
  source.forEach((allocation) => {
    const departmentId = String(allocation.department_id || '').trim();
    const amount = toNumber(allocation.amount);
    if (!departmentId || amount <= 0) return;
    merged.set(departmentId, (merged.get(departmentId) || 0) + amount);
  });

  return Array.from(merged.entries()).map(([department_id, amount]) => ({ department_id, amount }));
};

export const allocationTotalsMatchRequest = (requestAmount: number | string, allocations: { amount: number }[]) => {
  const total = allocations.reduce((sum, allocation) => sum + toNumber(allocation.amount), 0);
  return total.toFixed(2) === toNumber(requestAmount).toFixed(2);
};
