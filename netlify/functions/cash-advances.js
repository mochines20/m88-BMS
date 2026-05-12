const { supabase } = require('../utils/supabase');
const { authenticate, authorize } = require('../utils/auth');
const { validateExpense } = require('../utils/expenseValidator');

const toNumber = (value) => Number.parseFloat(value ?? 0) || 0;
const toText = (value) => String(value ?? '').trim();

// Input validation helpers
const validateUUID = (uuid) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};

const validateAmount = (amount) => {
  const num = toNumber(amount);
  return num > 0 && num <= 999999.99;
};

const sanitizeText = (text) => {
  return toText(text).replace(/[<>]/g, '').substring(0, 500);
};

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
      const { status, employee_id, overdue_only, status_in, fiscal_year } = event.queryStringParameters || {};
      
      let query = supabase
        .from('cash_advances')
        .select(`
          *,
          employee:users!cash_advances_employee_id_fkey(id, name, email),
          department:departments(id, name, fiscal_year),
          issuer:users!cash_advances_issued_by_fkey(id, name)
        `)
        .order('issued_at', { ascending: false });

      // Filter by fiscal year
      const targetFiscalYear = fiscal_year ? parseInt(fiscal_year) : new Date().getFullYear();
      query = query.eq('fiscal_year', targetFiscalYear);

      // Filter by status
      if (status) {
        query = query.eq('status', status);
      } else if (status_in) {
        const statuses = status_in.split(',').map(s => s.trim());
        query = query.in('status', statuses);
      }

      // Filter by employee (for non-finance users, only show own)
      if (user.role === 'employee' || user.role === 'manager') {
        query = query.eq('employee_id', user.id);
      } else if (employee_id && validateUUID(employee_id)) {
        query = query.eq('employee_id', employee_id);
      }

      // Overdue only
      if (overdue_only === 'true') {
        query = query.eq('status', 'overdue');
      }

      const { data, error } = await query;
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
        amount, 
        purpose, 
        liquidation_due_at,
        advance_code,
        fiscal_year
      } = JSON.parse(event.body);

      // Validate inputs
      if (!validateAmount(amount)) {
        return { 
          statusCode: 400, 
          body: JSON.stringify({ error: 'Invalid amount. Must be between 0.01 and 999,999.99' }) 
        };
      }

      if (!sanitizeText(purpose)) {
        return { 
          statusCode: 400, 
          body: JSON.stringify({ error: 'Purpose is required and must be valid text' }) 
        };
      }

      const targetFiscalYear = fiscal_year ? parseInt(fiscal_year) : new Date().getFullYear();
      
      // Get user's department for the fiscal year
      const { data: userDept, error: deptError } = await supabase
        .from('users')
        .select('department_id')
        .eq('id', user.id)
        .single();

      if (deptError || !userDept?.department_id) {
        return { 
          statusCode: 400, 
          body: JSON.stringify({ error: 'User department not found' }) 
        };
      }

      const advanceCode = advance_code || `CA-${Date.now()}`;
      const dueDate = liquidation_due_at ? new Date(liquidation_due_at) : null;

      const { data, error } = await supabase
        .from('cash_advances')
        .insert({
          advance_code: advanceCode,
          employee_id: user.id,
          department_id: userDept.department_id,
          amount_issued: toNumber(amount),
          amount_liquidated: 0,
          balance: toNumber(amount),
          purpose: sanitizeText(purpose),
          status: 'outstanding',
          issued_at: new Date(),
          liquidation_due_at: dueDate,
          fiscal_year: targetFiscalYear
        })
        .select()
        .single();

      if (error) throw error;

      return {
        statusCode: 201,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(data),
      };
    }

    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  } catch (error) {
    console.error('Cash advances error:', error);
    return {
      statusCode: error.message.includes('Forbidden') ? 403 : 
                 error.message.includes('Access denied') ? 401 : 500,
      body: JSON.stringify({ error: error.message || 'Internal server error' }),
    };
  }
};
