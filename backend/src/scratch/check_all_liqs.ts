import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkLiqs() {
  const { data: reqs } = await supabase.from('expense_requests').select('*').eq('request_type', 'liquidation').order('created_at', { ascending: false }).limit(5);
  console.log(JSON.stringify(reqs, null, 2));
}

checkLiqs();
