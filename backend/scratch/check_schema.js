const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'backend/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

async function checkSchema() {
  const { data, error } = await supabase
    .from('expense_requests')
    .select('*')
    .limit(1);
  
  if (error) {
    console.error('Error fetching expense_requests:', error);
    return;
  }
  
  if (data && data.length > 0) {
    console.log('Columns in expense_requests:', Object.keys(data[0]));
  } else {
    console.log('No data in expense_requests to check columns.');
  }

  const { data: catData, error: catError } = await supabase
    .from('budget_categories')
    .select('*')
    .limit(1);

  if (catError) {
    console.error('Error fetching budget_categories:', catError);
    return;
  }

  if (catData && catData.length > 0) {
    console.log('Columns in budget_categories:', Object.keys(catData[0]));
  }
}

checkSchema();
