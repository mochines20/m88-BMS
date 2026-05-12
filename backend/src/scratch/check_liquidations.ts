import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkLiquidations() {
  console.log('Checking recent liquidations...');
  
  const { data: liquidations, error } = await supabase
    .from('request_liquidations')
    .select('*, expense_requests(request_code, employee_id)')
    .order('created_at', { ascending: false })
    .limit(10);
    
  if (error) {
    console.error('Error fetching liquidations:', error);
  } else {
    console.log('Recent liquidations:');
    console.table(liquidations.map(l => ({
      id: l.id,
      req_code: l.expense_requests?.request_code,
      status: l.status,
      amount: l.actual_amount,
      created_at: l.created_at
    })));
  }
}

checkLiquidations();
