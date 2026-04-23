const { supabase } = require('../utils/supabase');
const { authenticate, authorize } = require('../utils/auth');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
      body: '',
    };
  }

  try {
    const token = event.headers.authorization;
    const user = authenticate(token);

    if (event.httpMethod === 'GET') {
      const { data, error } = await supabase.from('departments').select('*');
      if (error) return { statusCode: 400, body: JSON.stringify({ error }) };

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(data),
      };
    }

    if (event.httpMethod === 'PATCH') {
      authorize(['accounting', 'admin'])(user);

      const pathParts = event.path.split('/');
      const deptId = pathParts[pathParts.length - 2];
      const action = pathParts[pathParts.length - 1];

      if (action === 'budget') {
        const { annual_budget } = JSON.parse(event.body);

        const { data, error } = await supabase
          .from('departments')
          .update({ annual_budget, updated_at: new Date() })
          .eq('id', deptId)
          .select()
          .single();

        if (error) return { statusCode: 400, body: JSON.stringify({ error }) };

        return {
          statusCode: 200,
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify(data),
        };
      }

      return { statusCode: 404, body: JSON.stringify({ error: 'Action not found' }) };
    }

    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};