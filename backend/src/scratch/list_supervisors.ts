
import { supabase } from '../utils/supabase';

async function listSupervisors() {
  const { data: users } = await supabase.from('users').select('id, name, role').eq('role', 'supervisor');
  console.log('Supervisors in DB:', users);
}

listSupervisors();
