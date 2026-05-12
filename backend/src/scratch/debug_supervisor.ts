
import { supabase } from '../utils/supabase';

async function debugSupervisor() {
  // 1. Find the supervisor
  const { data: users } = await supabase.from('users').select('*').eq('role', 'supervisor');
  console.log('Supervisors:', users?.map(u => ({ id: u.id, name: u.name, dept_id: u.department_id })));

  // 2. Find pending requests for supervisors
  const { data: requests } = await supabase.from('expense_requests')
    .select('id, item_name, status, department_id, employee_id')
    .eq('status', 'pending_supervisor');
  
  console.log('Pending Supervisor Requests:', requests);

  // 3. Check departments
  const { data: depts } = await supabase.from('departments').select('id, name, fiscal_year');
  console.log('Departments:', depts);
}

debugSupervisor();
