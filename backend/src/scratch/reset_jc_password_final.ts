import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function resetPassword() {
  const email = 'jc@madison88.com';
  const newPassword = 'Hir@imomo20';
  const passwordHash = await bcrypt.hash(newPassword, 10);
  
  console.log(`Resetting password for ${email} to ${newPassword}...`);
  
  const { data, error } = await supabase
    .from('users')
    .update({ password_hash: passwordHash })
    .eq('email', email)
    .select();
    
  if (error) {
    console.error('Error resetting password:', error);
  } else {
    console.log('Password reset successful for:', data?.[0]?.email);
  }
}

resetPassword();
