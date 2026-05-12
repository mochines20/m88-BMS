import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkJC() {
  const { data: user } = await supabase.from('users').select('id, name').eq('email', 'jc@madison88.com').single();
  console.log(JSON.stringify(user, null, 2));
}

checkJC();
