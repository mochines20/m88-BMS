const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const envFiles = [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), 'backend', '.env')];
const env = {};

envFiles.forEach((filePath) => {
  if (!fs.existsSync(filePath)) return;
  const contents = fs.readFileSync(filePath, 'utf8');
  contents.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const [key, ...rest] = trimmed.split('=');
    env[key.trim()] = rest.join('=').trim();
  });
});

const SUPABASE_URL = env.SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error('\nERROR: Missing Supabase configuration.');
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE in root .env or backend/.env.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

const normalizeDepartmentName = (value) => String(value || '').trim();
const normalizeDepartmentKey = (value) => normalizeDepartmentName(value).toLowerCase();

const main = async () => {
  const targetFiscalYear = new Date().getFullYear();
  console.log(`Aligning legacy requests to fiscal year ${targetFiscalYear}...`);

  const { data: departments, error: departmentsError } = await supabase
    .from('departments')
    .select('id, name, fiscal_year, updated_at, created_at');

  if (departmentsError) {
    console.error('Failed to load departments:', departmentsError);
    process.exit(1);
  }

  const departmentsById = new Map();
  const departmentsByName = new Map();

  (departments || []).forEach((department) => {
    const key = normalizeDepartmentKey(department.name);
    departmentsById.set(department.id, department);
    const existing = departmentsByName.get(key) || [];
    existing.push(department);
    departmentsByName.set(key, existing);
  });

  const latestDepartmentByName = new Map();
  departmentsByName.forEach((departmentList, key) => {
    const latestDepartment = departmentList
      .slice()
      .sort((left, right) => {
        const leftTarget = Number(left.fiscal_year || 0) === targetFiscalYear ? 1 : 0;
        const rightTarget = Number(right.fiscal_year || 0) === targetFiscalYear ? 1 : 0;
        if (rightTarget !== leftTarget) return rightTarget - leftTarget;
        const leftYear = Number(left.fiscal_year || 0);
        const rightYear = Number(right.fiscal_year || 0);
        if (rightYear !== leftYear) return rightYear - leftYear;
        const leftUpdatedAt = new Date(left.updated_at || left.created_at || 0).getTime();
        const rightUpdatedAt = new Date(right.updated_at || right.created_at || 0).getTime();
        return rightUpdatedAt - leftUpdatedAt;
      })[0];

    if (latestDepartment) {
      latestDepartmentByName.set(key, latestDepartment);
    }
  });

  const { data: requests, error: requestsError } = await supabase
    .from('expense_requests')
    .select('id, request_code, department_id, fiscal_year');

  if (requestsError) {
    console.error('Failed to load expense requests:', requestsError);
    process.exit(1);
  }

  let migratedCount = 0;
  const migratedRequests = [];

  for (const request of requests || []) {
    const department = departmentsById.get(request.department_id);
    if (!department) continue;

    const key = normalizeDepartmentKey(department.name);
    const latestDepartment = latestDepartmentByName.get(key);
    if (!latestDepartment || latestDepartment.id === request.department_id) continue;

    const currentFiscalYear = Number(department.fiscal_year || 0);
    const latestFiscalYear = Number(latestDepartment.fiscal_year || 0);
    if (latestFiscalYear <= currentFiscalYear) continue;

    const { error: updateError } = await supabase
      .from('expense_requests')
      .update({ department_id: latestDepartment.id, fiscal_year: latestDepartment.fiscal_year })
      .eq('id', request.id);

    if (updateError) {
      console.error(`Failed to migrate request ${request.request_code} (${request.id}):`, updateError);
      continue;
    }

    const { data: allocations, error: allocationsError } = await supabase
      .from('request_allocations')
      .select('id, department_id, amount')
      .eq('request_id', request.id);

    if (allocationsError) {
      console.error(`Failed to load allocations for request ${request.request_code} (${request.id}):`, allocationsError);
      continue;
    }

    const oldAllocations = (allocations || []).filter((allocation) => allocation.department_id === request.department_id);
    const sameTargetAllocation = (allocations || []).find((allocation) => allocation.department_id === latestDepartment.id);

    for (const allocation of oldAllocations) {
      if (sameTargetAllocation && sameTargetAllocation.id !== allocation.id) {
        const mergedAmount = Number(sameTargetAllocation.amount || 0) + Number(allocation.amount || 0);
        const { error: mergeError } = await supabase
          .from('request_allocations')
          .update({ amount: mergedAmount })
          .eq('id', sameTargetAllocation.id);
        if (mergeError) {
          console.error(`Failed to merge allocation for request ${request.request_code} (${request.id}):`, mergeError);
          continue;
        }

        const { error: deleteError } = await supabase
          .from('request_allocations')
          .delete()
          .eq('id', allocation.id);
        if (deleteError) {
          console.error(`Failed to delete duplicate allocation for request ${request.request_code} (${request.id}):`, deleteError);
        }
      } else {
        const { error: allocationUpdateError } = await supabase
          .from('request_allocations')
          .update({ department_id: latestDepartment.id })
          .eq('id', allocation.id);
        if (allocationUpdateError) {
          console.error(`Failed to update allocation for request ${request.request_code} (${request.id}):`, allocationUpdateError);
        }
      }
    }

    migratedCount += 1;
    migratedRequests.push({ id: request.id, request_code: request.request_code, from: request.department_id, to: latestDepartment.id });
  }

  const { data: requestsWithoutFiscalYear, error: requestsWithoutFiscalYearError } = await supabase
    .from('expense_requests')
    .select('id, department_id')
    .or('fiscal_year.is.null,fiscal_year.eq.0');

  if (requestsWithoutFiscalYearError) {
    console.error('Failed to load requests that still need a fiscal year:', requestsWithoutFiscalYearError);
    process.exit(1);
  }

  for (const request of requestsWithoutFiscalYear || []) {
    const department = departmentsById.get(request.department_id);
    if (!department?.fiscal_year) continue;

    const { error: fiscalYearUpdateError } = await supabase
      .from('expense_requests')
      .update({ fiscal_year: department.fiscal_year })
      .eq('id', request.id);

    if (fiscalYearUpdateError) {
      console.error(`Failed to backfill fiscal year for request ${request.id}:`, fiscalYearUpdateError);
    }
  }

  console.log(`Completed migration. ${migratedCount} request(s) aligned to the latest fiscal year department.`);
  if (migratedRequests.length) {
    console.table(migratedRequests);
  } else {
    console.log('No requests required migration.');
  }
};

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
