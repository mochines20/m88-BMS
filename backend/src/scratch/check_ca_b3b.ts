import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkCA() {
  const { data: ca } = await supabase.from('cash_advances').select('*').eq('request_id', 'b3b2e10b-7042-43fc-b74e-de2d89421943').maybeSingle();
  console.log(JSON.stringify(ca, null, 2));
}

checkCA();
