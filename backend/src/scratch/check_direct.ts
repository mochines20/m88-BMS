import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDirect() {
  const { data, error } = await supabase.from('direct_expenses').select('count').limit(1);
  if (error) {
    console.error('Table direct_expenses FAILED:', error.message);
  } else {
    console.log('Table direct_expenses EXISTS');
  }
}

checkDirect();
