import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkJCAdvances() {
  const email = 'jc@madison88.com';
  const { data: user } = await supabase.from('users').select('id').eq('email', email).single();
  if (!user) return;
  
  const { data: advances } = await supabase.from('cash_advances').select('*').eq('employee_id', user.id);
  console.log(JSON.stringify(advances, null, 2));
}

checkJCAdvances();
