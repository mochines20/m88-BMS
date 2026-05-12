import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkReqRels() {
  const { data: req, error } = await supabase.from('expense_requests').select('*, users!fk_expense_requests_employee_id(name)').limit(1);
  if (error) {
    console.error('FK fk_expense_requests_employee_id FAILED:', error.message);
    // Try to find the correct one
    const { data: req2, error: error2 } = await supabase.from('expense_requests').select('*, users(name)').limit(1);
    console.log('Plain users join result:', error2?.message || 'SUCCESS');
  } else {
    console.log('FK fk_expense_requests_employee_id SUCCEEDED');
  }
}

checkReqRels();
