const { supabase } = require('../utils/supabase');
const { authenticate, authorize } = require('../utils/auth');
const { sendEmail } = require('../utils/email');
const { 
  getLatestConfiguredFiscalYear,
  getAccessibleDepartmentIdsForUser,
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
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
      body: '',
    };
  }

  try {
    const token = event.headers.authorization;
    const user = authenticate(token);

    if (event.httpMethod === 'GET') {
      const { fiscal_year, status, category } = event.queryStringParameters || {};
      const targetFiscalYear = fiscal_year ? validateFiscalYear(fiscal_year) : 
                              await getLatestConfiguredFiscalYear();

      let query = supabase
        .from('expense_requests')
        .select(`
          *,
          users(name),
          departments(name, fiscal_year)
        `)
        .eq('fiscal_year', targetFiscalYear);

      // Apply role-based filtering
      if (user.role === 'employee') {
        query = query.eq('employee_id', user.id);
      } else if (user.role === 'supervisor' || user.role === 'manager') {
        const accessibleDeptIds = await getAccessibleDepartmentIdsForUser(supabase, user, targetFiscalYear);
        query = query.in('department_id', accessibleDeptIds);
      }

      // Apply additional filters
      if (status) query = query.eq('status', status);
      if (category) query = query.eq('category', sanitizeText(category));

      const { data, error } = await query.order('submitted_at', { ascending: false });
      if (error) throw error;

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(data || []),
      };
    }

    if (event.httpMethod === 'POST') {
      authorize(['employee', 'manager'])(user);

      const { 
        item_name, 
        category, 
        category_id, 
        amount, 
        purpose, 
        priority,
        fiscal_year,
        request_type 
      } = JSON.parse(event.body);

      // Validate inputs
      const cleanItemName = sanitizeText(item_name);
      const cleanCategory = sanitizeText(category);
      const cleanPurpose = sanitizeText(purpose);
      const targetFiscalYear = fiscal_year ? validateFiscalYear(fiscal_year) : 
                              await getLatestConfiguredFiscalYear();
      const normalizedAmount = validateAmount(amount);

      if (!cleanItemName || !cleanCategory || !cleanPurpose) {
        return { 
          statusCode: 400, 
          body: JSON.stringify(createErrorResponse('Item name, category, and purpose are required', 400)) 
        };
      }

      // Validate priority
      const validPriorities = ['normal', 'urgent', 'low'];
      const cleanPriority = priority && validPriorities.includes(priority) ? priority : 'normal';

      // Validate category_id if provided
      let cleanCategoryId = null;
      if (category_id) {
        validateUUID(category_id);
        cleanCategoryId = category_id;
      }

      // Validate category budget (skip for cash advances)
      let categoryBudget = null;
      const requestType = request_type || 'request';
      
      if (requestType !== 'cash_advance') {
        const categoryQuery = cleanCategoryId 
          ? { id: cleanCategoryId }
          : { category_name: cleanCategory, department_id: user.department_id };

        const { data: budgetData, error: categoryError } = await supabase
          .from('budget_categories')
          .select('id, remaining_amount, category_name, fiscal_year')
          .eq('fiscal_year', targetFiscalYear)
          .match(categoryQuery)
          .maybeSingle();
        
        if (categoryError) throw categoryError;
        if (!budgetData) {
          return { 
            statusCode: 400, 
            body: JSON.stringify(createErrorResponse(`Category "${cleanCategory}" not found for fiscal year ${targetFiscalYear}`, 400)) 
          };
        }
        
        categoryBudget = budgetData;
        const remaining = Number(categoryBudget.remaining_amount);
        if (remaining < normalizedAmount) {
          return { 
            statusCode: 400, 
            body: JSON.stringify(createErrorResponse(
              `Insufficient budget in "${cleanCategory}". Available: ₱${remaining.toFixed(2)}, Requested: ₱${normalizedAmount.toFixed(2)}`, 
              400
            )) 
          };
        }
      }

      const request_code = requestType === 'cash_advance' ? `CA-${Date.now()}` : `REQ-${Date.now()}`;

      const { data, error } = await supabase
        .from('expense_requests')
        .insert({
          request_code,
          employee_id: user.id,
          department_id: user.department_id,
          fiscal_year: targetFiscalYear,
          item_name: cleanItemName,
          category: cleanCategory,
          category_id: cleanCategoryId || categoryBudget?.id,
          amount: normalizedAmount,
          purpose: cleanPurpose,
          priority: cleanPriority,
          status: requestType === 'cash_advance' ? 'pending_accounting' : 'pending_supervisor',
          metadata: { request_type: requestType },
          submitted_at: new Date()
        })
        .select()
        .single();

      if (error) throw error;

      await supabase.from('approval_logs').insert({
        request_id: data.id,
        actor_id: user.id,
        action: 'submitted',
        stage: 'supervisor',
        note: 'Request submitted'
      });

      // Notify supervisor
      const { data: supervisor } = await supabase.from('users')
        .select('email')
        .eq('department_id', user.department_id)
        .eq('role', 'supervisor')
        .single();
      if (supervisor) {
        sendEmail(supervisor.email, 'New Expense Request', `New request ${request_code} submitted.`);
      }

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(data),
      };
    }

    return { 
      statusCode: 405, 
      body: JSON.stringify(createErrorResponse('Method not allowed', 405)) 
    };
  } catch (error) {
    console.error('Requests error:', error);
    return {
      statusCode: error.message.includes('Forbidden') ? 403 : 
                 error.message.includes('Access denied') ? 401 : 500,
      body: JSON.stringify(createErrorResponse(error.message || 'Internal server error', 500)),
    };
  }
};
