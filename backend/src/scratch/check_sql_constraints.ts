import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSQL() {
  const sql = "SELECT conname, pg_get_constraintdef(oid) as def FROM pg_constraint WHERE conrelid = 'cash_advances'::regclass";
  const { data, error } = await supabase.rpc('execute_sql', { sql });
  if (error) {
    console.error('RPC execute_sql failed. You likely do not have permission or it does not exist.');
  } else {
    console.log(data);
  }
}

checkSQL();
