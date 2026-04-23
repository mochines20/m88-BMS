import express from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { supabase } from '../utils/supabase';

const router = express.Router();

// GET /api/expenses - direct expenses
router.get('/', authenticate, async (req: any, res) => {
  let query = supabase.from('direct_expenses').select('*');
  if (req.user.role === 'supervisor') {
    query = query.eq('logged_by', req.user.id);
  }
  const { data, error } = await query;
  if (error) return res.status(400).json({ error });
  res.json(data);
});

// POST /api/expenses - supervisor logs direct expense
router.post('/', authenticate, authorize('supervisor'), async (req: any, res) => {
  const { item_name, category, amount, description, expense_date } = req.body;
  const { data: dept } = await supabase.from('departments').select('*').eq('id', req.user.department_id).single();
  if (dept.annual_budget - dept.used_budget < amount) {
    return res.status(400).json({ error: 'Insufficient budget' });
  }
  const { data, error } = await supabase
    .from('direct_expenses')
    .insert({
      department_id: req.user.department_id,
      logged_by: req.user.id,
      item_name,
      category,
      amount,
      description,
      expense_date
    })
    .select()
    .single();
  if (error) return res.status(400).json({ error });
  // Deduct budget
  await supabase.from('departments').update({ used_budget: dept.used_budget + amount }).eq('id', dept.id);
  res.json(data);
});

export default router;