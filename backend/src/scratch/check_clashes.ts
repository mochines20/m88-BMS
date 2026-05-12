
import { supabase } from '../utils/supabase';

async function checkClashes() {
  const { data: depts } = await supabase.from('departments').select('id, name').eq('name', 'HR Department');
  if (!depts || !depts[0]) return;
  
  const { data: cats } = await supabase.from('budget_categories').select('*').eq('department_id', depts[0].id);
  console.log('Existing Categories for HR:', cats);
}

checkClashes();
