
import { supabase } from '../utils/supabase';

async function listCategories() {
  const { data, error } = await supabase.from('budget_categories').select('category_name').limit(20);
  if (error) {
    console.error('Error fetching categories:', error);
    return;
  }
  const uniqueCats = Array.from(new Set(data.map(c => c.category_name)));
  console.log('Categories in database:', uniqueCats);
}

listCategories();
