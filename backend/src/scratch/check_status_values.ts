import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkConstraints() {
  const { data, error } = await supabase.rpc('get_check_constraints', { t_name: 'cash_advances' });
  // If rpc fails, try raw query if possible, or just list distinct statuses
  if (error) {
    const { data: statuses } = await supabase.from('cash_advances').select('status');
    const distinct = [...new Set(statuses?.map(s => s.status))];
    console.log('Distinct statuses in DB:', distinct);
  } else {
    console.log(data);
  }
}

checkConstraints();
