import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function testBudgetLogic() {
  console.log('Testing budget logic fetch...');
  const { data, error } = await supabase
    .from('request_allocations')
    .select('id, request_id, department_id, amount, departments(name, fiscal_year)')
    .limit(1);
    
  if (error) {
    console.error('Budget Logic Error:', error.message);
  } else {
    console.log('Budget Logic Success!');
  }
}

testBudgetLogic();
