
import { supabase } from '../utils/supabase';

async function debugSupervisorShort() {
  const { data: users } = await supabase.from('users').select('id, name, role, department_id').eq('role', 'supervisor');
  console.log('Supervisors:', users);

  const { data: requests } = await supabase.from('expense_requests')
    .select('id, item_name, status, department_id')
    .eq('status', 'pending_supervisor');
  console.log('Pending Requests:', requests);

  const { data: depts } = await supabase.from('departments').select('id, name, fiscal_year');
  console.log('Depts:', depts);
}

debugSupervisorShort();
