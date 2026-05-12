import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkLatestRequests() {
  const email = 'jc@madison88.com';
  console.log(`Checking latest requests for ${email}...`);
  
  const { data: user } = await supabase.from('users').select('id').eq('email', email).single();
  if (!user) {
    console.error('User not found');
    return;
  }
  
  const { data: requests, error } = await supabase
    .from('expense_requests')
    .select('id, request_code, request_type, item_name, status, submitted_at')
    .eq('employee_id', user.id)
    .order('submitted_at', { ascending: false })
    .limit(10);
    
  if (error) {
    console.error('Error fetching requests:', error);
  } else {
    console.log('Latest requests:');
    console.table(requests);
  }
}

checkLatestRequests();
