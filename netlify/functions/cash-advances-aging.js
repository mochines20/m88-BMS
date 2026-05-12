const { supabase } = require('../utils/supabase');
const { authenticate, authorize } = require('../utils/auth');

const toNumber = (value) => Number.parseFloat(value ?? 0) || 0;

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
    
    authorize(['accounting', 'admin', 'super_admin', 'management'])(user);

    const { fiscal_year, department_id } = event.queryStringParameters || {};
    const targetFiscalYear = fiscal_year ? parseInt(fiscal_year) : new Date().getFullYear();

    let query = supabase
      .from('cash_advances')
      .select(`
        *,
        employee:users!cash_advances_employee_id_fkey(id, name, email, department_id),
        department:departments(id, name, fiscal_year)
      `)
      .eq('fiscal_year', targetFiscalYear)
      .in('status', ['outstanding', 'partially_liquidated', 'overdue'])
      .order('liquidation_due_at', { ascending: true });

    if (department_id) {
      query = query.eq('department_id', department_id);
    }

    const { data: cashAdvances, error } = await query;
    if (error) throw error;

    // Calculate aging buckets
    const now = new Date();
    const agingReport = (cashAdvances || []).map((ca) => {
      const dueDate = ca.liquidation_due_at ? new Date(ca.liquidation_due_at) : null;
      const daysOpen = dueDate 
        ? Math.floor((now.getTime() - new Date(ca.issued_at).getTime()) / (1000 * 60 * 60 * 24))
        : 0;
      const daysOverdue = dueDate && now > dueDate
        ? Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))
        : 0;

      let agingBucket = 'Current';
      if (daysOverdue > 0) {
        if (daysOverdue <= 7) agingBucket = '1-7 Days';
        else if (daysOverdue <= 14) agingBucket = '8-14 Days';
        else if (daysOverdue <= 30) agingBucket = '15-30 Days';
        else agingBucket = '30+ Days';
      }

      return {
        id: ca.id,
        advance_code: ca.advance_code,
        employee_name: ca.employee?.name || 'Unknown',
        department_name: ca.department?.name || 'Unknown',
        amount_issued: toNumber(ca.amount_issued),
        amount_liquidated: toNumber(ca.amount_liquidated),
        balance: toNumber(ca.balance),
        issued_at: ca.issued_at,
        liquidation_due_at: ca.liquidation_due_at,
        days_open: daysOpen,
        days_overdue: daysOverdue,
        aging_bucket: agingBucket,
        status: ca.status
      };
    });

    // Summary statistics
    const summary = {
      total_advances: agingReport.length,
      total_amount_issued: agingReport.reduce((sum, ca) => sum + ca.amount_issued, 0),
      total_amount_liquidated: agingReport.reduce((sum, ca) => sum + ca.amount_liquidated, 0),
      total_outstanding_balance: agingReport.reduce((sum, ca) => sum + ca.balance, 0),
      overdue_advances: agingReport.filter(ca => ca.days_overdue > 0).length,
      overdue_amount: agingReport.filter(ca => ca.days_overdue > 0).reduce((sum, ca) => sum + ca.balance, 0),
      aging_breakdown: agingReport.reduce((acc, ca) => {
        acc[ca.aging_bucket] = (acc[ca.aging_bucket] || 0) + 1;
        return acc;
      }, {})
    };

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        summary,
        advances: agingReport
      }),
    };
  } catch (error) {
    console.error('Cash advances aging error:', error);
    return {
      statusCode: error.message.includes('Forbidden') ? 403 : 
                 error.message.includes('Access denied') ? 401 : 500,
      body: JSON.stringify({ error: error.message || 'Internal server error' }),
    };
  }
};
