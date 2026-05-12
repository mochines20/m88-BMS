import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkConstraintText() {
  const { data, error } = await supabase.rpc('get_check_constraint_definition', { table_name: 'cash_advances', constraint_name: 'cash_advances_status_check' });
  if (error) {
    // Try raw query
    const { data: rawData, error: rawError } = await supabase.from('pg_constraint' as any).select('consrc' as any).eq('conname' as any, 'cash_advances_status_check').maybeSingle();
    console.log('Raw constraint data:', rawData || rawError);
  } else {
    console.log('Constraint definition:', data);
  }
}

checkConstraintText();
