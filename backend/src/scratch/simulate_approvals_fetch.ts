import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function simulateFrontend() {
  console.log('Fetching all partially/fully liquidated advances...');
  const { data: advances, error: listError } = await supabase
    .from('cash_advances')
    .select(`
        *,
        employee:users!cash_advances_employee_id_fkey(id, name, email),
        department:departments(id, name),
        issuer:users!cash_advances_issued_by_fkey(id, name)
      `)
    .in('status', ['partially_liquidated', 'fully_liquidated']);
    
  if (listError) {
    console.error('List Error:', listError.message);
    return;
  }
  
  console.log(`Found ${advances?.length} advances. Fetching details...`);
  
  for (const advance of (advances || [])) {
    console.log(`- Fetching detail for ${advance.advance_code} (${advance.id})...`);
    const { data: detailed, error: detailError } = await supabase
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
      
    if (detailError) {
      console.error(`  Detail Error for ${advance.advance_code}:`, detailError.message);
    } else {
      console.log(`  Detail Success for ${advance.advance_code}`);
    }
  }
}

simulateFrontend();
