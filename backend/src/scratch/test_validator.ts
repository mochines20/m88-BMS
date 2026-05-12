
import { supabase } from '../utils/supabase';
import { OFFICIAL_EXPENSE_LIST } from '../utils/expenseValidator';

async function test() {
  console.log('Official List Length:', OFFICIAL_EXPENSE_LIST.length);
  console.log('First Item:', OFFICIAL_EXPENSE_LIST[0]);
}

test();
