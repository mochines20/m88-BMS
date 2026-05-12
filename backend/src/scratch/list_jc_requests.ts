import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function listJCRequests() {
  const { data: reqs } = await supabase.from('expense_requests').select('request_code, request_type, item_name, status, amount').eq('employee_id', 'd21c5afe-14c1-4c25-aec9-9c25c8232deb');
  console.table(reqs);
}

listJCRequests();
