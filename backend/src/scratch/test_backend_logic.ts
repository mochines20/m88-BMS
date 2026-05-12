import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function testBackendLogic() {
  const status_in = 'partially_liquidated,fully_liquidated';
  const statuses = status_in.split(',');
  
  console.log('Searching for statuses:', statuses);
  
  const { data, error } = await supabase
    .from('cash_advances')
    .select(`
        *,
        employee:users(id, name, email),
        department:departments(id, name),
        issuer:users!cash_advances_issued_by_fkey(id, name)
      `)
    .in('status', statuses)
    .order('issued_at', { ascending: false });
    
  if (error) {
    console.error(error);
  } else {
    console.log('Data count:', data?.length);
    data?.forEach(a => console.log(`- ${a.advance_code} : ${a.status}`));
  }
}

testBackendLogic();
