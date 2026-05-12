
import { supabase } from '../utils/supabase';

async function checkJane() {
  const { data: user } = await supabase.from('users').select('*').eq('name', 'Jane Supervisor').single();
  if (!user) {
    console.log('Jane Supervisor not found');
    return;
  }
  console.log('Jane User Data:', { id: user.id, dept_id: user.department_id, role: user.role });

  const { data: dept } = await supabase.from('departments').select('*').eq('id', user.department_id).single();
  console.log('Jane Department:', dept);

  // Find all departments with the same name
  const { data: relatedDepts } = await supabase.from('departments').select('*').ilike('name', dept.name);
  const relatedIds = relatedDepts?.map(d => d.id) || [];
  console.log('Related Dept IDs:', relatedIds);

  const { data: requests } = await supabase.from('expense_requests')
    .select('id, item_name, status, department_id')
    .in('department_id', relatedIds)
    .eq('status', 'pending_supervisor');
  
  console.log('Requests for Jane:', requests);
}

checkJane();
