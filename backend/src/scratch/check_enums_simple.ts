import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkEnums() {
  // Use any to avoid TS issues
  const { data, error } = await (supabase as any).from('pg_type').select('typname').eq('typtype', 'e');
  console.log(data || error);
}

checkEnums();
