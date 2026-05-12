import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function findStatuses() {
  const { data, error } = await supabase.rpc('get_check_constraints_definition', { table_name: 'cash_advances' });
  if (error) {
     // List all check constraints
     console.log('RPC failed. Listing all check constraints text...');
     const { data: list, error: listError } = await supabase.rpc('execute_sql', { sql: "SELECT check_clause FROM information_schema.check_constraints JOIN information_schema.constraint_column_usage USING (constraint_name) WHERE table_name = 'cash_advances' AND column_name = 'status'" });
     console.log(list || listError);
  } else {
    console.log(data);
  }
}

findStatuses();
