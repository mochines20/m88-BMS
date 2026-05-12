const { supabase } = require('../utils/supabase');
const { authenticate, authorize } = require('../utils/auth');
const { toNumber } = require('../utils/budget');

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
      const { department_id, fiscal_year } = event.queryStringParameters || {};
      let query = supabase.from('budget_categories').select('*');
      
      if (department_id) query = query.eq('department_id', department_id);
      if (fiscal_year) query = query.eq('fiscal_year', fiscal_year);
      
      const { data, error } = await query.order('category_name');
      if (error) return { statusCode: 400, body: JSON.stringify({ error }) };

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(data),
      };
    }

    if (event.httpMethod === 'POST') {
      authorize(['accounting', 'admin'])(user);
      const { department_id, category_code, category_name, budget_amount, fiscal_year } = JSON.parse(event.body);
      
      const requestedBudget = toNumber(budget_amount);
      const { data, error } = await supabase
        .from('budget_categories')
        .insert({
          department_id,
          fiscal_year: fiscal_year || new Date().getFullYear(),
          category_code: category_code.toUpperCase(),
          category_name,
          budget_amount: requestedBudget,
          remaining_amount: requestedBudget,
          updated_at: new Date()
        })
        .select()
        .single();

      if (error) return { statusCode: 400, body: JSON.stringify({ error }) };

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

      const { data: current } = await supabase.from('budget_categories').select('*').eq('id', id).single();
      if (!current) return { statusCode: 404, body: JSON.stringify({ error: 'Category not found' }) };

      const requestedBudget = toNumber(budget_amount);
      const newRemaining = requestedBudget - toNumber(current.used_amount) - toNumber(current.committed_amount);

      const { data, error } = await supabase
        .from('budget_categories')
        .update({
          budget_amount: requestedBudget,
          category_name: category_name || current.category_name,
          remaining_amount: newRemaining,
          updated_at: new Date()
        })
        .eq('id', id)
        .select()
        .single();

      if (error) return { statusCode: 400, body: JSON.stringify({ error }) };
      return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(data) };
    }

    if (event.httpMethod === 'DELETE') {
      authorize(['accounting', 'admin'])(user);
      const pathParts = event.path.split('/');
      const id = pathParts[pathParts.length - 1];

      const { error } = await supabase.from('budget_categories').delete().eq('id', id);
      if (error) return { statusCode: 400, body: JSON.stringify({ error }) };

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ message: 'Deleted' }),
      };
    }

    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
