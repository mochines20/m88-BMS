import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkReqDept() {
  const { data, error } = await supabase.from('expense_requests').select('*, departments!fk_expense_requests_department_id(name)').limit(1);
  if (error) {
    console.error('FK fk_expense_requests_department_id FAILED:', error.message);
  } else {
    console.log('FK fk_expense_requests_department_id SUCCEEDED');
  }
}

checkReqDept();
