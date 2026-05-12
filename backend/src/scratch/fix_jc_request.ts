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
  if (!request) {
    console.error('Request not found');
    return;
  }
  
  // 1. Update request_type to cash_advance
  const { error: updateError } = await supabase
    .from('expense_requests')
    .update({ request_type: 'cash_advance' })
    .eq('id', request.id);
    
  if (updateError) {
    console.error('Failed to update request_type:', updateError);
    return;
  }
  console.log('Updated request_type to cash_advance.');
  
  // 2. Create cash_advances record
  const advanceCode = `CA-${Date.now().toString().slice(-6)}`;
  const { data: ca, error: caError } = await supabase
    .from('cash_advances')
    .insert({
      request_id: request.id,
      employee_id: request.employee_id,
      department_id: request.department_id,
      advance_code: advanceCode,
      amount_issued: request.amount,
      amount_liquidated: 123, // From the liquidation record we found
      balance: 877,
      expected_liquidation_date: new Date(),
      purpose: request.purpose,
      status: 'pending_liquidation_review', // Set directly to review status!
      issued_at: request.released_at || new Date(),
      issued_by: request.released_by || request.employee_id,
      created_at: new Date(),
      updated_at: new Date()
    })
    .select()
    .single();
    
  if (caError) {
    console.error('Failed to create cash_advances record:', caError);
  } else {
    console.log('Created cash_advances record:', ca.advance_code);
  }
}

fixJCRequest();
