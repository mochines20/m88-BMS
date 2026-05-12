
import { supabase } from '../utils/supabase';

async function checkDeptColumns() {
  const { data, error } = await supabase.from('departments').select('*').limit(1);
  if (error) {
    console.error('Error fetching depts:', error);
    return;
  }
  console.log('Department columns:', Object.keys(data[0] || {}));
}

checkDeptColumns();
