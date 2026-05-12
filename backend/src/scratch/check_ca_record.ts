import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkCARecord() {
  const reqCode = 'REQ-1778031969625';
  console.log(`Checking Cash Advance record for ${reqCode}...`);
  
  const { data: request } = await supabase.from('expense_requests').select('id').eq('request_code', reqCode).single();
  if (!request) {
    console.error('Request not found');
    return;
  }
  
  const { data: ca, error } = await supabase
    .from('cash_advances')
    .select('*')
    .eq('request_id', request.id)
    .maybeSingle();
    
  if (error) {
    console.error('Error fetching CA:', error);
  } else if (!ca) {
    console.log('NO Cash Advance record found for this request ID.');
  } else {
    console.log('Cash Advance record found:');
    console.table(ca);
  }
}

checkCARecord();
