
import { supabase } from '../utils/supabase';

async function debugJanes() {
  const { data: users } = await supabase.from('users').select('id, name, department_id, role').eq('name', 'Jane Supervisor');
  console.log('Janes:', users);

  for (const jane of (users || [])) {
    const { data: dept } = await supabase.from('departments').select('*').eq('id', jane.department_id).single();
    console.log(`Jane (${jane.id}) Department:`, dept?.name, `(Year: ${dept?.fiscal_year})`);
    
    // Find requests for this dept
    const { data: requests } = await supabase.from('expense_requests')
      .select('id, item_name, status, department_id')
      .eq('department_id', jane.department_id)
      .eq('status', 'pending_supervisor');
    console.log(`  Requests for this specific ID:`, requests);
  }

  // Check all pending supervisor requests regardless of dept
  const { data: allPending } = await supabase.from('expense_requests')
    .select('id, item_name, status, department_id, users(name)')
    .eq('status', 'pending_supervisor');
  console.log('All Pending Supervisor Requests:', allPending);
}

debugJanes();
