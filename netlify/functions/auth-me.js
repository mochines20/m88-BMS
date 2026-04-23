const { supabase } = require('../utils/supabase');
const { authenticate } = require('../utils/auth');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const token = event.headers.authorization;
    const user = authenticate(token);

    const { data: userData, error } = await supabase
      .from('users')
      .select('id, name, email, role, department_id')
      .eq('id', user.id)
      .single();

    if (error) {
      return { statusCode: 400, body: JSON.stringify({ error }) };
    }

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify(userData),
    };
  } catch (error) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: error.message }),
    };
  }
};