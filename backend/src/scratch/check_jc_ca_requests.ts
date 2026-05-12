import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkJCRequests() {
  const { data: reqs } = await supabase.from('expense_requests').select('*').eq('employee_id', 'd21c5afe-14c1-4c25-aec9-9c25c8232deb').eq('request_type', 'cash_advance');
  console.log(JSON.stringify(reqs, null, 2));
}

checkJCRequests();
