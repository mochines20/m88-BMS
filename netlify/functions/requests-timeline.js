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
    const pathParts = event.path.split('/');
    const requestId = pathParts[pathParts.length - 1];

    const { data, error } = await supabase
      .from('approval_logs')
      .select('*')
      .eq('request_id', requestId)
      .order('timestamp', { ascending: true });

    if (error) return { statusCode: 400, body: JSON.stringify({ error }) };

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(data),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};