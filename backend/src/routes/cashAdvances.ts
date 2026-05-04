import { Router } from 'express';
import { supabase } from '../utils/supabase';
import { authenticate, authorize } from '../middleware/auth';
import { getLatestConfiguredFiscalYear } from '../utils/fiscal';

const router = Router();

// GET /api/cash-advances - List cash advances
router.get('/', authenticate, async (req: any, res) => {
  try {
    const { status, employee_id, overdue_only } = req.query;

    let query = supabase
      .from('cash_advances')
      .select(`
        *,
        employee:users(id, name, email),
        department:departments(id, name),
        issuer:users!cash_advances_issued_by_fkey(id, name)
      `)
      .order('issued_at', { ascending: false });

    // Filter by status
    if (status) {
      query = query.eq('status', status);
    }

    // Filter by employee (for non-finance users, only show own)
    if (req.user.role === 'employee') {
      query = query.eq('employee_id', req.user.id);
    } else if (employee_id) {
      query = query.eq('employee_id', employee_id);
    }

    // Overdue only
    if (overdue_only === 'true') {
      query = query.eq('status', 'overdue');
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json(data || []);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/cash-advances/aging - Cash advance aging report
router.get('/aging', authenticate, authorize('accounting', 'admin', 'super_admin', 'management'), async (req: any, res) => {
  try {
    const { data: cashAdvances, error } = await supabase
      .from('cash_advances')
      .select(`
        *,
        employee:users(id, name, email, department_id),
        department:departments(id, name)
      `)
      .in('status', ['outstanding', 'partially_liquidated', 'overdue'])
      .order('liquidation_due_at', { ascending: true });

    if (error) throw error;

    // Calculate aging buckets
    const now = new Date();
    const agingReport = (cashAdvances || []).map((ca: any) => {
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
        amount_issued: Number(ca.amount_issued),
        amount_liquidated: Number(ca.amount_liquidated),
        balance: Number(ca.balance),
        issued_at: ca.issued_at,
        liquidation_due_at: ca.liquidation_due_at,
        days_open: daysOpen,
        days_overdue: daysOverdue,
        aging_bucket: agingBucket,
        status: ca.status,
        purpose: ca.purpose
      };
    });

    // Group by aging bucket
    const summary = {
      'Current': agingReport.filter((r: any) => r.aging_bucket === 'Current'),
      '1-7 Days': agingReport.filter((r: any) => r.aging_bucket === '1-7 Days'),
      '8-14 Days': agingReport.filter((r: any) => r.aging_bucket === '8-14 Days'),
      '15-30 Days': agingReport.filter((r: any) => r.aging_bucket === '15-30 Days'),
      '30+ Days': agingReport.filter((r: any) => r.aging_bucket === '30+ Days')
    };

    res.json({
      total_outstanding: agingReport.reduce((sum: number, r: any) => sum + r.balance, 0),
      total_count: agingReport.length,
      overdue_count: agingReport.filter((r: any) => r.days_overdue > 0).length,
      summary,
      details: agingReport
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/cash-advances/:id - Get cash advance details with liquidation items
router.get('/:id', authenticate, async (req: any, res) => {
  try {
    const { id } = req.params;

    const { data: cashAdvance, error: caError } = await supabase
      .from('cash_advances')
      .select(`
        *,
        employee:users(id, name, email),
        department:departments(id, name),
        issuer:users!cash_advances_issued_by_fkey(id, name),
        original_request:expense_requests(id, request_code, status)
      `)
      .eq('id', id)
      .single();

    if (caError) throw caError;
    if (!cashAdvance) {
      return res.status(404).json({ error: 'Cash advance not found' });
    }

    // Check permission
    if (req.user.role === 'employee' && cashAdvance.employee_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Get liquidation items
    const { data: items, error: itemsError } = await supabase
      .from('liquidation_items')
      .select(`
        *,
        category:budget_categories(id, category_code, category_name)
      `)
      .eq('cash_advance_id', id)
      .order('expense_date', { ascending: true });

    if (itemsError) throw itemsError;

    res.json({
      ...cashAdvance,
      liquidation_items: items || []
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/cash-advances - Create cash advance (when request is approved)
router.post('/', authenticate, authorize('accounting', 'admin', 'super_admin'), async (req: any, res) => {
  try {
    const { request_id, amount_issued, expected_liquidation_date, purpose, liquidation_due_at } = req.body;

    // Get request details
    const { data: request, error: reqError } = await supabase
      .from('expense_requests')
      .select('*, users(id, name, email, department_id)')
      .eq('id', request_id)
      .single();

    if (reqError || !request) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const advanceCode = `CA-${Date.now().toString().slice(-6)}`;

    const { data, error } = await supabase
      .from('cash_advances')
      .insert({
        request_id,
        employee_id: request.employee_id,
        department_id: request.department_id,
        advance_code: advanceCode,
        amount_issued,
        amount_liquidated: 0,
        balance: amount_issued,
        expected_liquidation_date,
        liquidation_due_at: liquidation_due_at || expected_liquidation_date,
        purpose: purpose || request.purpose,
        status: 'outstanding',
        issued_at: new Date(),
        issued_by: req.user.id
      })
      .select()
      .single();

    if (error) throw error;

    // Update request to link to cash advance
    await supabase
      .from('expense_requests')
      .update({ 
        status: 'released',
        released_at: new Date(),
        released_by: req.user.id,
        disbursement_status: 'released'
      })
      .eq('id', request_id);

    res.json(data);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/cash-advances/:id/liquidate - Add liquidation items
router.post('/:id/liquidate', authenticate, authorize('employee', 'accounting', 'admin', 'super_admin'), async (req: any, res) => {
  try {
    const { id } = req.params;
    const { items, liquidation_request_id } = req.body;
    // items: [{ expense_date, category_id, description, amount, receipt_attached }]

    // Get cash advance
    const { data: cashAdvance, error: caError } = await supabase
      .from('cash_advances')
      .select('*')
      .eq('id', id)
      .single();

    if (caError || !cashAdvance) {
      return res.status(404).json({ error: 'Cash advance not found' });
    }

    // Check permission
    if (req.user.role === 'employee' && cashAdvance.employee_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Insert liquidation items
    const itemsToInsert = items.map((item: any) => ({
      cash_advance_id: id,
      liquidation_id: liquidation_request_id,
      expense_date: item.expense_date,
      category_id: item.category_id,
      description: item.description,
      amount: item.amount,
      receipt_attached: item.receipt_attached || false,
      created_at: new Date()
    }));

    const { data: insertedItems, error: insertError } = await supabase
      .from('liquidation_items')
      .insert(itemsToInsert)
      .select();

    if (insertError) throw insertError;

    // Update cash advance status will be handled by trigger
    res.json({
      message: 'Liquidation items added',
      items: insertedItems,
      cash_advance_id: id
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/cash-advances/employee/:employee_id - Get employee's cash advances
router.get('/employee/:employee_id', authenticate, async (req: any, res) => {
  try {
    const { employee_id } = req.params;

    // Check permission
    if (req.user.role === 'employee' && req.user.id !== employee_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { data, error } = await supabase
      .from('cash_advances')
      .select(`
        *,
        department:departments(id, name)
      `)
      .eq('employee_id', employee_id)
      .order('issued_at', { ascending: false });

    if (error) throw error;

    res.json(data || []);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/cash-advances/for-liquidation/:employee_id - Get outstanding advances available for liquidation
router.get('/for-liquidation/:employee_id', authenticate, async (req: any, res) => {
  try {
    const { employee_id } = req.params;

    // Check permission
    if (req.user.role === 'employee' && req.user.id !== employee_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { data, error } = await supabase
      .from('cash_advances')
      .select(`
        *,
        department:departments(id, name)
      `)
      .eq('employee_id', employee_id)
      .in('status', ['outstanding', 'partially_liquidated', 'overdue'])
      .gt('balance', 0)
      .order('issued_at', { ascending: false });

    if (error) throw error;

    res.json(data || []);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
