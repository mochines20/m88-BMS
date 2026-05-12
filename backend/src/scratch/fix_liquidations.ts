import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixGhostLiquidations() {
  console.log('Fetching submitted liquidations with no corresponding CA status update...');
  
  const { data: liquidations, error: liqError } = await supabase
    .from('request_liquidations')
    .select('request_id, status')
    .eq('status', 'submitted');
    
  if (liqError) {
    console.error('Error fetching liquidations:', liqError);
    return;
  }
  
  console.log(`Found ${liquidations.length} submitted liquidations.`);
  
  for (const liq of liquidations) {
    const { data: cashAdvance, error: caFetchError } = await supabase
      .from('cash_advances')
      .select('id, status')
      .eq('request_id', liq.request_id)
      .maybeSingle();
      
    if (caFetchError) {
      console.error(`Error fetching CA for request ${liq.request_id}:`, caFetchError);
      continue;
    }
    
    if (cashAdvance && cashAdvance.status !== 'pending_liquidation_review') {
      console.log(`Updating Cash Advance ${cashAdvance.id} status to pending_liquidation_review...`);
      const { error: updateError } = await supabase
        .from('cash_advances')
        .update({ status: 'pending_liquidation_review', updated_at: new Date() })
        .eq('id', cashAdvance.id);
        
      if (updateError) console.error(`Failed to update CA ${cashAdvance.id}:`, updateError);
      else console.log(`Successfully updated CA ${cashAdvance.id}.`);
    } else {
      console.log(`Cash Advance for request ${liq.request_id} is already in correct status or not found.`);
    }
  }
  
  console.log('Cleanup complete.');
}

fixGhostLiquidations();
