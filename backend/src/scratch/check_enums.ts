import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkEnums() {
  const { data, error } = await supabase.from('pg_type' as any).select('typname' as any).eq('typtype' as any, 'e' as any);
  console.log(data || error);
}

checkEnums();
