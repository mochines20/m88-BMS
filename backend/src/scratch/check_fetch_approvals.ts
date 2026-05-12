import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkFetch() {
  const { data: advances, error } = await supabase
    .from('cash_advances')
    .select('*, liquidations:request_liquidations(id, status)')
    .in('status', ['partially_liquidated', 'fully_liquidated']);
    
  if (error) {
    console.error(error);
  } else {
    console.log('Advances found:', advances.length);
    advances.forEach(a => {
      console.log(`- ${a.advance_code} (${a.status}) | Liqs: ${a.liquidations?.length || 0}`);
      a.liquidations?.forEach((l: any) => console.log(`  * ${l.id} : ${l.status}`));
    });
  }
}

checkFetch();
