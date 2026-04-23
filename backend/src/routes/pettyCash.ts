import express from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { supabase } from '../utils/supabase';

const router = express.Router();
const toNumber = (value: any) => Number.parseFloat(value ?? 0) || 0;

// GET /api/petty-cash/:dept_id
router.get('/:dept_id', authenticate, async (req: any, res) => {
  if (req.user.role !== 'accounting' && req.user.role !== 'admin' && req.user.department_id !== req.params.dept_id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { data, error } = await supabase
    .from('petty_cash_transactions')
    .select('*')
    .eq('department_id', req.params.dept_id)
    .order('transaction_date', { ascending: false });
  if (error) return res.status(400).json({ error });
  res.json(data);
});

// POST /api/petty-cash/disburse
router.post('/disburse', authenticate, authorize('accounting', 'admin'), async (req: any, res) => {
  const { department_id, amount, purpose, reference_request_id } = req.body;
  const normalizedPurpose = String(purpose || '').trim();
  const normalizedAmount = toNumber(amount);
  const { data: dept } = await supabase.from('departments').select('*').eq('id', department_id).single();
  if (!department_id) {
    return res.status(400).json({ error: 'Department is required' });
  }
  if (!normalizedPurpose) {
    return res.status(400).json({ error: 'Reason is required when deducting petty cash' });
  }
  if (normalizedAmount <= 0) {
    return res.status(400).json({ error: 'Amount must be greater than zero' });
  }
  if (!dept) {
    return res.status(404).json({ error: 'Department not found' });
  }
  if (toNumber(dept.petty_cash_balance) < normalizedAmount) {
    return res.status(400).json({ error: 'Insufficient petty cash' });
  }
  const { data, error } = await supabase
    .from('petty_cash_transactions')
    .insert({
      department_id,
      managed_by: req.user.id,
      type: 'disbursement',
      amount: normalizedAmount,
      purpose: normalizedPurpose,
      reference_request_id,
      transaction_date: new Date()
    })
    .select()
    .single();
  if (error) return res.status(400).json({ error });
  // Deduct petty cash
  await supabase.from('departments').update({ petty_cash_balance: toNumber(dept.petty_cash_balance) - normalizedAmount }).eq('id', dept.id);
  res.json(data);
});

// POST /api/petty-cash/replenish
router.post('/replenish', authenticate, authorize('accounting', 'admin'), async (req: any, res) => {
  const { department_id, amount, purpose } = req.body;
  const normalizedPurpose = String(purpose || '').trim();
  const normalizedAmount = toNumber(amount);
  if (!department_id) {
    return res.status(400).json({ error: 'Department is required' });
  }
  if (!normalizedPurpose) {
    return res.status(400).json({ error: 'Reason is required when replenishing petty cash' });
  }
  if (normalizedAmount <= 0) {
    return res.status(400).json({ error: 'Amount must be greater than zero' });
  }
  const { data, error } = await supabase
    .from('petty_cash_transactions')
    .insert({
      department_id,
      managed_by: req.user.id,
      type: 'replenishment',
      amount: normalizedAmount,
      purpose: normalizedPurpose,
      transaction_date: new Date()
    })
    .select()
    .single();
  if (error) return res.status(400).json({ error });
  // Add to petty cash
  const { data: dept } = await supabase.from('departments').select('*').eq('id', department_id).single();
  if (!dept) {
    return res.status(404).json({ error: 'Department not found' });
  }
  await supabase.from('departments').update({ petty_cash_balance: toNumber(dept.petty_cash_balance) + normalizedAmount }).eq('id', dept.id);
  res.json(data);
});

export default router;
