import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkLiq() {
  const { data: liq } = await supabase.from('request_liquidations').select('*').eq('id', 'cc6d8a26-8954-48b3-87e2-8c1c98ad64da').single();
  console.log(JSON.stringify(liq, null, 2));
}

checkLiq();
