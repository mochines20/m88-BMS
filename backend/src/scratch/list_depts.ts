
import { supabase } from '../utils/supabase';

async function listDepts() {
  const { data, error } = await supabase.from('departments').select('name').limit(20);
  if (error) {
    console.error('Error fetching depts:', error);
    return;
  }
  console.log('Departments in database:', data.map(d => d.name));
}

listDepts();
