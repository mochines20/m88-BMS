const { supabase } = require('../utils/supabase');
const { authenticate, authorize } = require('../utils/auth');
const { toNumber } = require('../utils/budget');
const { 
  getLatestConfiguredFiscalYear, 
  syncDepartmentBudget,
  validateFiscalYear 
} = require('../utils/fiscal');
const { 
  validateUUID, 
  validateAmount, 
  sanitizeText,
  createErrorResponse 
} = require('../utils/enhancedAuth');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
      body: '',
    };
  }

  try {
    const token = event.headers.authorization;
    const user = authenticate(token);

    if (event.httpMethod === 'GET') {
      const { department_id, fiscal_year, all_years } = event.queryStringParameters || {};
      let query = supabase.from('budget_categories').select('*');
      
      // Get active fiscal year if not specified
      const targetFiscalYear = fiscal_year ? validateFiscalYear(fiscal_year) : 
                              await getLatestConfiguredFiscalYear();
      
      if (!all_years || all_years !== 'true') {
        query = query.eq('fiscal_year', targetFiscalYear);
      }
      
      if (department_id) {
        validateUUID(department_id);
        query = query.eq('department_id', department_id);
      }
      
      const { data, error } = await query.order('category_name');
      if (error) throw error;

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(data || []),
      };
    }

    if (event.httpMethod === 'POST') {
      authorize(['accounting', 'admin'])(user);
      
      const { 
        department_id, 
        category_code, 
        category_name, 
        budget_amount, 
        fiscal_year 
      } = JSON.parse(event.body);
      
      // Validate inputs
      validateUUID(department_id);
      const targetFiscalYear = fiscal_year ? validateFiscalYear(fiscal_year) : 
                              await getLatestConfiguredFiscalYear();
      
      const requestedBudget = validateAmount(budget_amount);
      const cleanCategoryCode = sanitizeText(category_code).toUpperCase();
      const cleanCategoryName = sanitizeText(category_name);
      
      if (!cleanCategoryCode || !cleanCategoryName) {
        return { 
          statusCode: 400, 
          body: JSON.stringify(createErrorResponse('Category code and name are required', 400)) 
        };
      }
      
      // Check for duplicate category code in same department/fiscal year
      const { data: existing, error: checkError } = await supabase
        .from('budget_categories')
        .select('id')
        .eq('department_id', department_id)
        .eq('fiscal_year', targetFiscalYear)
        .eq('category_code', cleanCategoryCode)
        .maybeSingle();

      if (checkError) throw checkError;
      if (existing) {
        return { 
          statusCode: 409, 
          body: JSON.stringify(createErrorResponse('Category code already exists in this department', 409)) 
        };
      }
      
      const { data, error } = await supabase
        .from('budget_categories')
        .insert({
          department_id,
          fiscal_year: targetFiscalYear,
          category_code: cleanCategoryCode,
          category_name: cleanCategoryName,
          budget_amount: requestedBudget,
          remaining_amount: requestedBudget,
          updated_at: new Date()
        })
        .select()
        .single();

      if (error) throw error;

      // Sync department budget after adding category
      await syncDepartmentBudget(department_id, targetFiscalYear);

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(data),
      };
    }

    if (event.httpMethod === 'PUT') {
      authorize(['accounting', 'admin'])(user);
      const pathParts = event.path.split('/');
      const id = pathParts[pathParts.length - 1];
      const { budget_amount, category_name } = JSON.parse(event.body);

      validateUUID(id);
      const requestedBudget = validateAmount(budget_amount);
      const cleanCategoryName = category_name ? sanitizeText(category_name) : null;

      const { data: current, error: fetchError } = await supabase
        .from('budget_categories')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchError || !current) {
        return { 
          statusCode: 404, 
          body: JSON.stringify(createErrorResponse('Category not found', 404)) 
        };
      }

      const newRemaining = requestedBudget - toNumber(current.used_amount) - toNumber(current.committed_amount);

      const { data, error } = await supabase
        .from('budget_categories')
        .update({
          budget_amount: requestedBudget,
          category_name: cleanCategoryName || current.category_name,
          remaining_amount: Math.max(0, newRemaining),
          updated_at: new Date()
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      // Sync department budget after updating category
      await syncDepartmentBudget(current.department_id, current.fiscal_year);

      return { 
        statusCode: 200, 
        headers: { 'Access-Control-Allow-Origin': '*' }, 
        body: JSON.stringify(data) 
      };
    }

    if (event.httpMethod === 'DELETE') {
      authorize(['accounting', 'admin'])(user);
      const pathParts = event.path.split('/');
      const id = pathParts[pathParts.length - 1];

      validateUUID(id);

      // Get category info before deletion for budget sync
      const { data: category, error: fetchError } = await supabase
        .from('budget_categories')
        .select('department_id, fiscal_year')
        .eq('id', id)
        .single();

      if (fetchError || !category) {
        return { 
          statusCode: 404, 
          body: JSON.stringify(createErrorResponse('Category not found', 404)) 
        };
      }

      const { error } = await supabase.from('budget_categories').delete().eq('id', id);
      if (error) throw error;

      // Sync department budget after deleting category
      await syncDepartmentBudget(category.department_id, category.fiscal_year);

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ message: 'Deleted' }),
      };
    }

    return { 
      statusCode: 405, 
      body: JSON.stringify(createErrorResponse('Method not allowed', 405)) 
    };
  } catch (error) {
    console.error('Budget categories error:', error);
    return {
      statusCode: error.message.includes('Forbidden') ? 403 : 
                 error.message.includes('Access denied') ? 401 : 500,
      body: JSON.stringify(createErrorResponse(error.message || 'Internal server error', 500)),
    };
  }
};
