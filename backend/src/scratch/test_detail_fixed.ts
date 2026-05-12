import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function testDetail() {
  const { data: advance } = await supabase.from('cash_advances').select('id').limit(1).single();
  if (!advance) {
    console.log('No advances to test detail with.');
    return;
  }
  
  console.log('Testing detail for:', advance.id);
  
  const { data, error } = await supabase
    .from('cash_advances')
    .select(`
        *,
        employee:users!cash_advances_employee_id_fkey(id, name, email),
        department:departments(id, name),
        issuer:users!cash_advances_issued_by_fkey(id, name),
        original_request:expense_requests!cash_advances_request_id_fkey(id, request_code, status)
      `)
    .eq('id', advance.id)
    .single();
    
  if (error) {
    console.error(error);
  } else {
    console.log('Detail success!');
    console.log('Employee:', data.employee?.name);
    console.log('Request Code:', data.original_request?.request_code);
  }
}

testDetail();
