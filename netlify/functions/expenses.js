const { supabase } = require('../utils/supabase');
const { authenticate, authorize } = require('../utils/auth');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
      body: '',
    };
  }

  try {
    const token = event.headers.authorization;
    const user = authenticate(token);

    if (event.httpMethod === 'GET') {
      let query = supabase.from('direct_expenses').select('*');
      if (user.role === 'supervisor') {
        query = query.eq('logged_by', user.id);
      }
      const { data, error } = await query;
      if (error) return { statusCode: 400, body: JSON.stringify({ error }) };

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(data),
      };
    }

    if (event.httpMethod === 'POST') {
      authorize(['supervisor'])(user);

      const { item_name, category, amount, description, expense_date } = JSON.parse(event.body);
      const { data: dept } = await supabase.from('departments').select('*').eq('id', user.department_id).single();
      if (dept.annual_budget - dept.used_budget < amount) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Insufficient budget' }) };
      }

      const { data, error } = await supabase
        .from('direct_expenses')
        .insert({
          department_id: user.department_id,
          logged_by: user.id,
          item_name,
          category,
          amount,
          description,
          expense_date
        })
        .select()
        .single();

      if (error) return { statusCode: 400, body: JSON.stringify({ error }) };

      await supabase.from('departments').update({ used_budget: dept.used_budget + amount }).eq('id', dept.id);

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(data),
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