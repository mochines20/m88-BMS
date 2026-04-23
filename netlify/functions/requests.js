const { supabase } = require('../utils/supabase');
const { authenticate, authorize } = require('../utils/auth');
const { sendEmail } = require('../utils/email');

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
      let query = supabase.from('expense_requests').select('*, users(name)');
      if (user.role === 'employee') {
        query = query.eq('employee_id', user.id);
      } else if (user.role === 'supervisor') {
        query = query.eq('department_id', user.department_id);
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
      authorize(['employee'])(user);

      const { item_name, category, amount, purpose, priority } = JSON.parse(event.body);
      const request_code = `REQ-${Date.now()}`;

      const { data, error } = await supabase
        .from('expense_requests')
        .insert({
          request_code,
          employee_id: user.id,
          department_id: user.department_id,
          item_name,
          category,
          amount,
          purpose,
          priority,
          status: 'pending_supervisor',
          submitted_at: new Date()
        })
        .select()
        .single();

      if (error) return { statusCode: 400, body: JSON.stringify({ error }) };

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

    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
