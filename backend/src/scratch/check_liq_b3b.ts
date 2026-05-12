import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkLiq() {
  const { data } = await supabase.from('request_liquidations').select('*').eq('request_id', 'b3b2e10b-7042-43fc-b74e-de2d89421943');
  console.log(data);
}

checkLiq();
