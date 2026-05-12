import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyCA() {
  const { data: ca } = await supabase.from('cash_advances').select('*').eq('employee_id', 'd21c5afe-14c1-4c25-aec9-9c25c8232deb').single();
  if (ca) {
    console.log('Cash Advance Status:', ca.status);
    const { data: liqs } = await supabase.from('request_liquidations').select('*').eq('request_id', ca.request_id);
    console.log('Liquidations found:', liqs?.length);
    liqs?.forEach(l => console.log(`- ${l.id} : ${l.status}`));
  } else {
    console.log('No CA found for JC');
  }
}

verifyCA();
