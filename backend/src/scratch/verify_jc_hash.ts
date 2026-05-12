import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyHash() {
  const email = 'jc@madison88.com';
  const password = 'Password123!';
  
  const { data: user, error } = await supabase
    .from('users')
    .select('password_hash')
    .eq('email', email)
    .single();
    
  if (error || !user) {
    console.error('User not found');
    return;
  }
  
  const isMatch = await bcrypt.compare(password, user.password_hash);
  console.log(`Password match for ${email} with "Password123!": ${isMatch}`);
  console.log(`Hash in DB: ${user.password_hash}`);
}

verifyHash();
