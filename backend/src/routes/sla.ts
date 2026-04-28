import express from 'express';
import { supabase } from '../utils/supabase';
import { authenticate } from '../middleware/auth';

const router = express.Router();

const toNumber = (value: unknown) => Number.parseFloat(String(value ?? 0)) || 0;

router.get('/', authenticate, async (req, res) => {
  try {
    const { policy_type, is_active } = req.query;

    let query = supabase
      .from('sla_policies')
      .select('*')
      .order('created_at', { ascending: false });

    if (policy_type) {
      query = query.eq('policy_type', policy_type);
    }

    if (is_active !== undefined) {
      query = query.eq('is_active', is_active === 'true');
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json({ policies: data || [] });
  } catch (error: any) {
    console.error('Error fetching SLA policies:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { deadline_days, escalation_action, is_active } = req.body;

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (deadline_days !== undefined) updates.deadline_days = deadline_days;
    if (escalation_action !== undefined) updates.escalation_action = escalation_action;
    if (is_active !== undefined) updates.is_active = is_active;

    const { data, error } = await supabase
      .from('sla_policies')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Policy not found' });

    res.json(data);
  } catch (error: any) {
    console.error('Error updating SLA policy:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/', authenticate, async (req, res) => {
  try {
    const { policy_name, policy_type, trigger_condition, deadline_days, escalation_action } = req.body;

    if (!policy_name || !policy_type || !trigger_condition || deadline_days === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { data, error } = await supabase
      .from('sla_policies')
      .insert({
        policy_name,
        policy_type,
        trigger_condition,
        deadline_days,
        escalation_action
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (error: any) {
    console.error('Error creating SLA policy:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/check-liquidations', authenticate, async (req, res) => {
  try {
    const now = new Date();
    const warningDays = 3;

    // Use explicit join syntax or handle relation error gracefully
    const { data: liquidations, error } = await supabase
      .from('request_liquidations')
      .select(`
        id,
        liquidation_no,
        status,
        due_at,
        request:expense_requests(
          id,
          request_code,
          item_name,
          amount,
          employee:users(name, email)
        )
      `)
      .eq('status', 'pending_submission')
      .not('due_at', 'is', null);

    if (error) {
      console.error('Supabase error in check-liquidations:', error);
      return res.status(500).json({ error: `Database error: ${error.message}` });
    }

    const overdue = [];
    const dueSoon = [];
    const upcoming = [];

    for (const liquidation of (liquidations || [])) {
      if (!liquidation.due_at) continue;

      const dueDate = new Date(liquidation.due_at);
      const daysUntilDue = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      // Robustly handle nested data
      const request = (liquidation as any).request;
      const employee = request?.employee;

      const item = {
        id: liquidation.id,
        liquidation_no: liquidation.liquidation_no,
        request_code: request?.request_code || 'N/A',
        item_name: request?.item_name || 'Unknown',
        amount: request?.amount || 0,
        employee_name: employee?.name || 'Unknown',
        employee_email: employee?.email || '',
        due_at: liquidation.due_at,
        days_until_due: daysUntilDue,
        status: 'pending'
      };

      if (daysUntilDue < 0) {
        overdue.push({ ...item, status: 'overdue', days_overdue: Math.abs(daysUntilDue) });
      } else if (daysUntilDue <= warningDays) {
        dueSoon.push({ ...item, status: 'due_soon' });
      } else {
        upcoming.push(item);
      }
    }

    res.json({
      summary: {
        total: liquidations?.length || 0,
        overdue: overdue.length,
        due_soon: dueSoon.length,
        upcoming: upcoming.length
      },
      overdue,
      due_soon: dueSoon,
      upcoming
    });
  } catch (error: any) {
    console.error('Error checking liquidation deadlines:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
