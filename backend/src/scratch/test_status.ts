import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function testStatus() {
  const { error } = await supabase
    .from('cash_advances')
    .insert({
      request_id: 'b3b2e10b-7042-43fc-b74e-de2d89421943',
      employee_id: 'd21c5afe-14c1-4c25-aec9-9c25c8232deb',
      department_id: '1320d89d-5b10-457e-a335-c4f80bc6e3db',
      advance_code: 'TEST-1',
      amount_issued: 1000,
      amount_liquidated: 0,
      balance: 1000,
      status: 'outstanding'
    });
  if (error) console.error('Status "outstanding" FAILED:', error.message);
  else console.log('Status "outstanding" SUCCEEDED');
}

testStatus();
