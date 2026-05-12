import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkBucket() {
  console.log('Checking storage buckets...');
  const { data: buckets, error } = await supabase.storage.listBuckets();
  
  if (error) {
    console.error('Error listing buckets:', error);
    return;
  }
  
  console.log('Buckets found:', buckets.map(b => `${b.name} (public: ${b.public})`));
  
  const attachments = buckets.find(b => b.name === 'attachments');
  if (!attachments) {
    console.log('Bucket "attachments" NOT FOUND. Creating it...');
    const { error: createError } = await supabase.storage.createBucket('attachments', { public: true });
    if (createError) console.error('Error creating bucket:', createError);
    else console.log('Bucket created successfully.');
  } else if (!attachments.public) {
    console.log('Bucket "attachments" is NOT public. Updating...');
    const { error: updateError } = await supabase.storage.updateBucket('attachments', { public: true });
    if (updateError) console.error('Error updating bucket:', updateError);
    else console.log('Bucket updated to public.');
  } else {
    console.log('Bucket "attachments" is already public.');
  }
}

checkBucket();
