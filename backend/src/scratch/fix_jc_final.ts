import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixJCRequest() {
  const reqCode = 'REQ-1778031969625';
  console.log(`Fixing request ${reqCode}...`);
  
  const { data: request } = await supabase.from('expense_requests').select('*').eq('request_code', reqCode).single();
  if (!request) return;
  
  await supabase.from('expense_requests').update({ request_type: 'cash_advance' }).eq('id', request.id);
  
  const advanceCode = `CA-${Date.now().toString().slice(-6)}`;
  const { data: ca, error } = await supabase
    .from('cash_advances')
    .insert({
      request_id: request.id,
      employee_id: request.employee_id,
      department_id: request.department_id,
      advance_code: advanceCode,
      amount_issued: request.amount,
      amount_liquidated: 123,
      balance: 877,
      status: 'partially_liquidated',
      issued_at: request.released_at || new Date(),
      issued_by: request.released_by || request.employee_id
    })
    .select()
    .single();
    
  if (error) console.error(error);
  else console.log('Fixed! CA Code:', ca.advance_code);
}

fixJCRequest();
