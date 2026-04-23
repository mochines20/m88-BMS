const { supabase } = require('../utils/supabase');
const { authenticate, authorize } = require('../utils/auth');
const { sendEmail } = require('../utils/email');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'PATCH') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const token = event.headers.authorization;
    const user = authenticate(token);
    const pathParts = event.path.split('/');
    const requestId = pathParts[pathParts.length - 2];
    const action = pathParts[pathParts.length - 1];

    const { data: request, error: fetchError } = await supabase
      .from('expense_requests')
      .select('*')
      .eq('id', requestId)
      .single();

    if (fetchError) return { statusCode: 400, body: JSON.stringify({ error: fetchError }) };

    if (action === 'approve') {
      authorize(['supervisor', 'accounting'])(user);

      if (user.role === 'supervisor' && request.department_id !== user.department_id) {
        return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
      }

      let newStatus = '';
      let stage = '';
      if (user.role === 'supervisor') {
        newStatus = 'pending_accounting';
        stage = 'accounting';
      } else if (user.role === 'accounting') {
        const { data: dept } = await supabase.from('departments').select('*').eq('id', request.department_id).single();
        if (dept.annual_budget - dept.used_budget < request.amount) {
          return { statusCode: 400, body: JSON.stringify({ error: 'Insufficient budget' }) };
        }
        newStatus = 'released';
        stage = 'finance';
        await supabase.from('departments').update({ used_budget: dept.used_budget + request.amount }).eq('id', dept.id);
      }

      const { data, error } = await supabase
        .from('expense_requests')
        .update({ status: newStatus, updated_at: new Date() })
        .eq('id', requestId)
        .select()
        .single();

      if (error) return { statusCode: 400, body: JSON.stringify({ error }) };

      await supabase.from('approval_logs').insert({
        request_id: requestId,
        actor_id: user.id,
        action: 'approved',
        stage,
        note: JSON.parse(event.body).note || ''
      });

      // Notify employee
      const { data: employee } = await supabase.from('users').select('email').eq('id', request.employee_id).single();
      if (employee) {
        sendEmail(employee.email, 'Request Approved', `Your request ${request.request_code} has been approved.`);
      }

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(data),
      };
    }

    if (action === 'reject') {
      authorize(['supervisor', 'accounting'])(user);

      if (user.role === 'supervisor' && request.department_id !== user.department_id) {
        return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
      }

      const { reason } = JSON.parse(event.body);
      const stage = user.role === 'supervisor' ? 'supervisor' : 'accounting';

      const { data, error } = await supabase
        .from('expense_requests')
        .update({ status: 'rejected', rejection_reason: reason, rejection_stage: stage, updated_at: new Date() })
        .eq('id', requestId)
        .select()
        .single();

      if (error) return { statusCode: 400, body: JSON.stringify({ error }) };

      await supabase.from('approval_logs').insert({
        request_id: requestId,
        actor_id: user.id,
        action: 'rejected',
        stage,
        note: reason
      });

      // Notify employee
      const { data: employee } = await supabase.from('users').select('email').eq('id', request.employee_id).single();
      if (employee) {
        sendEmail(employee.email, 'Request Rejected', `Your request ${request.request_code} has been rejected: ${reason}`);
      }

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(data),
      };
    }

    return { statusCode: 404, body: JSON.stringify({ error: 'Action not found' }) };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};