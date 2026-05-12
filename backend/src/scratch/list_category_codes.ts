
import { supabase } from '../utils/supabase';

async function listCategoryCodes() {
  const { data, error } = await supabase.from('budget_categories').select('category_code, category_name').limit(20);
  if (error) {
    console.error('Error fetching categories:', error);
    return;
  }
  console.log('Categories in database:', data);
}

listCategoryCodes();
