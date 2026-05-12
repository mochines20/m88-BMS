const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'backend/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

const toNumber = (v) => parseFloat(v || 0);

async function syncBudgets() {
  console.log('Starting full budget synchronization...');

  // 1. Get all categories
  const { data: categories, error: catError } = await supabase.from('budget_categories').select('*');
  if (catError) throw catError;

  // 2. Get all requests
  const { data: requests, error: reqError } = await supabase.from('expense_requests').select('*');
  if (reqError) throw reqError;

  const categoryUpdates = new Map();

  // Initialize all categories with 0 committed and 0 used
  categories.forEach(cat => {
    categoryUpdates.set(cat.id, {
      used_amount: 0,
      committed_amount: 0,
      budget_amount: toNumber(cat.budget_amount)
    });
  });

  // Calculate totals from requests
  for (const req of requests) {
    if (!req.category && !req.category_id) continue;

    // Find the category record
    let category = categories.find(c => c.id === req.category_id);
    if (!category && req.category) {
        // Fallback to name match
        category = categories.find(c => 
            c.category_name.trim().toLowerCase() === req.category.trim().toLowerCase() && 
            c.department_id === req.department_id &&
            c.fiscal_year === req.fiscal_year
        );
    }

    if (!category) {
        console.warn(`Category not found for request ${req.request_code}: ${req.category}`);
        continue;
    }

    const stats = categoryUpdates.get(category.id);
    const amount = toNumber(req.amount);

    if (req.status === 'released') {
        stats.used_amount += amount;
    } else if (['pending_supervisor', 'pending_accounting', 'approved', 'on_hold'].includes(req.status)) {
        stats.committed_amount += amount;
    }
  }

  // 3. Update database
  console.log(`Updating ${categoryUpdates.size} categories...`);
  for (const [id, stats] of categoryUpdates.entries()) {
    const remaining = stats.budget_amount - stats.used_amount - stats.committed_amount;
    const { error } = await supabase.from('budget_categories').update({
        used_amount: stats.used_amount,
        committed_amount: stats.committed_amount,
        remaining_amount: Math.max(0, remaining),
        updated_at: new Date()
    }).eq('id', id);

    if (error) console.error(`Error updating category ${id}:`, error);
  }

  console.log('Synchronization complete!');
}

syncBudgets();
