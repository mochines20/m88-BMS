const { supabase } = require('./supabase');

// Fiscal year utilities for Netlify functions (matching backend logic)

const getLatestConfiguredFiscalYear = async () => {
  try {
    const { data, error } = await supabase
      .from('fiscal_years')
      .select('year')
      .eq('is_active', true)
      .order('year', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      // Fallback to current year if no fiscal years configured
      return new Date().getFullYear();
    }

    return data.year;
  } catch (err) {
    console.warn('Error fetching fiscal year, using current year:', err);
    return new Date().getFullYear();
  }
};

const syncDepartmentBudget = async (department_id, fiscal_year) => {
  try {
    // Get all categories for this department in the specified fiscal year
    const { data: categories, error: catError } = await supabase
      .from('budget_categories')
      .select('budget_amount')
      .eq('department_id', department_id)
      .eq('fiscal_year', fiscal_year);

    if (catError) throw catError;

    const total = (categories || []).reduce((sum, cat) => sum + (Number(cat.budget_amount) || 0), 0);

    // Get the department name so we can update ALL duplicate rows with the same name+FY
    const { data: dept, error: deptError } = await supabase
      .from('departments')
      .select('name')
      .eq('id', department_id)
      .single();

    if (deptError || !dept?.name) {
      throw new Error('Department not found');
    }

    // Update all rows matching this name+FY (handles duplicates)
    const { error: updateError } = await supabase
      .from('departments')
      .update({ 
        annual_budget: total, 
        updated_at: new Date() 
      })
      .ilike('name', dept.name)
      .eq('fiscal_year', fiscal_year);

    if (updateError) throw updateError;

    return total;
  } catch (error) {
    console.error('Error syncing department budget:', error);
    throw error;
  }
};

const getAccessibleDepartmentIdsForUser = async (supabaseClient, user, fiscal_year) => {
  try {
    if (!user || !user.id) {
      return [];
    }

    // Super admin can access all departments
    if (user.role === 'super_admin') {
      const { data: allDepts } = await supabaseClient
        .from('departments')
        .select('id')
        .eq('fiscal_year', fiscal_year);
      return (allDepts || []).map(d => d.id);
    }

    // Admin and accounting can access all departments
    if (user.role === 'admin' || user.role === 'accounting') {
      const { data: allDepts } = await supabaseClient
        .from('departments')
        .select('id')
        .eq('fiscal_year', fiscal_year);
      return (allDepts || []).map(d => d.id);
    }

    // VP and President can access all departments
    if (user.role === 'vp' || user.role === 'president') {
      const { data: allDepts } = await supabaseClient
        .from('departments')
        .select('id')
        .eq('fiscal_year', fiscal_year);
      return (allDepts || []).map(d => d.id);
    }

    // For other roles, get their department
    if (user.department_id) {
      // Verify the department exists in the target fiscal year
      const { data: userDept } = await supabaseClient
        .from('departments')
        .select('id')
        .eq('id', user.department_id)
        .eq('fiscal_year', fiscal_year)
        .single();

      return userDept ? [userDept.id] : [];
    }

    return [];
  } catch (error) {
    console.error('Error getting accessible departments:', error);
    return [];
  }
};

const syncUserDepartmentToActiveYear = async (supabaseClient, user) => {
  try {
    if (!user || !user.department_id || user.role === 'super_admin') {
      return user;
    }

    const activeFiscalYear = await getLatestConfiguredFiscalYear();
    
    // Get user's current department info
    const { data: currentDept } = await supabaseClient
      .from('departments')
      .select('id, name, fiscal_year')
      .eq('id', user.department_id)
      .single();

    if (!currentDept) {
      return user;
    }

    // If user's department is already in the active fiscal year, return as-is
    if (currentDept.fiscal_year === activeFiscalYear) {
      return user;
    }

    // Find the equivalent department in the active fiscal year
    const { data: activeDept } = await supabaseClient
      .from('departments')
      .select('id')
      .eq('name', currentDept.name)
      .eq('fiscal_year', activeFiscalYear)
      .single();

    if (activeDept) {
      // Update user's department_id to the active year version
      const { error: updateError } = await supabaseClient
        .from('users')
        .update({ department_id: activeDept.id })
        .eq('id', user.id);

      if (!updateError) {
        return { ...user, department_id: activeDept.id };
      }
    }

    return user;
  } catch (error) {
    console.error('Error syncing user department:', error);
    return user;
  }
};

const validateFiscalYear = (year) => {
  const num = parseInt(year);
  const currentYear = new Date().getFullYear();
  
  if (isNaN(num) || num < 2020 || num > currentYear + 5) {
    throw new Error(`Invalid fiscal year: ${year}. Must be between 2020 and ${currentYear + 5}`);
  }
  
  return num;
};

module.exports = {
  getLatestConfiguredFiscalYear,
  syncDepartmentBudget,
  getAccessibleDepartmentIdsForUser,
  syncUserDepartmentToActiveYear,
  validateFiscalYear
};
