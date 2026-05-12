const { supabase } = require('./supabase');

const toNumber = (value) => Number.parseFloat(value ?? 0) || 0;

/**
 * Find the budget category linked to a request
 */
const findRequestCategory = async (request) => {
  if (!request) return null;
  
  // Try matching by category_id first
  if (request.category_id) {
    const { data } = await supabase
      .from('budget_categories')
      .select('id, category_code, category_name, budget_amount, remaining_amount, used_amount, committed_amount')
      .eq('id', request.category_id)
      .maybeSingle();
    if (data) return data;
  }
  
  // Fallback to matching by category name/code
  if (request.category && request.department_id) {
    const cleanCode = String(request.category).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const { data } = await supabase
      .from('budget_categories')
      .select('id, category_code, category_name, budget_amount, remaining_amount, used_amount, committed_amount')
      .eq('department_id', request.department_id)
      .ilike('category_code', cleanCode)
      .maybeSingle();
    
    if (data) return data;
    
    // Try matching by category_name if code didn't match
    const { data: dataByName } = await supabase
      .from('budget_categories')
      .select('id, category_code, category_name, budget_amount, remaining_amount, used_amount, committed_amount')
      .eq('department_id', request.department_id)
      .ilike('category_name', request.category)
      .maybeSingle();
      
    if (dataByName) return dataByName;
  }
  
  return null;
};

/**
 * Adjust category committed_amount by delta
 */
const adjustCategoryCommitted = async (request, delta) => {
  try {
    const category = await findRequestCategory(request);
    if (!category) return { ok: false, reason: 'category_not_found' };
    
    const newCommitted = Math.max(0, toNumber(category.committed_amount) + toNumber(delta));
    const { error } = await supabase
      .from('budget_categories')
      .update({ committed_amount: newCommitted, updated_at: new Date() })
      .eq('id', category.id);
      
    if (error) return { ok: false, reason: error.message };
    return { ok: true, category, newCommitted };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
};

/**
 * On release - subtract from committed_amount and add to used_amount
 */
const adjustCategoryReleased = async (request) => {
  try {
    const category = await findRequestCategory(request);
    if (!category) return { ok: false, reason: 'category_not_found' };
    
    const amount = toNumber(request.amount);
    const newCommitted = Math.max(0, toNumber(category.committed_amount) - amount);
    const newUsed = toNumber(category.used_amount) + amount;
    const newRemaining = Math.max(0, toNumber(category.budget_amount) - newUsed);
    
    const { error } = await supabase
      .from('budget_categories')
      .update({ 
        committed_amount: newCommitted, 
        used_amount: newUsed,
        remaining_amount: newRemaining,
        updated_at: new Date() 
      })
      .eq('id', category.id);
      
    if (error) return { ok: false, reason: error.message };
    return { ok: true, category, newCommitted, newUsed };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
};

module.exports = {
  findRequestCategory,
  adjustCategoryCommitted,
  adjustCategoryReleased,
  toNumber
};
