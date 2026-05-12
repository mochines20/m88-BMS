import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function findStatuses() {
  const { data, error } = await supabase.rpc('get_check_constraint_definitions', { t_name: 'cash_advances' });
  if (error) {
     console.log('RPC failed, trying raw query via another RPC...');
     // Some Supabase setups have a generic exec_sql or similar
     const { data: qData, error: qError } = await supabase.from('cash_advances').select('status').limit(1);
     console.log('Example data status:', qData?.[0]?.status);
  } else {
    console.log(data);
  }
}

findStatuses();
