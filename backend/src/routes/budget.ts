import { Router } from 'express';
import { supabase } from '../utils/supabase';
import { authenticate, authorize } from '../middleware/auth';
import { getLatestConfiguredFiscalYear } from '../utils/fiscal';

const router = Router();
const toNumber = (value: any) => Number.parseFloat(value ?? 0) || 0;

// GET /api/budget/categories - Get budget categories for a department
router.get('/categories', authenticate, async (req: any, res) => {
  try {
    const { department_id, fiscal_year } = req.query;
    const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
    const targetFiscalYear = fiscal_year ? parseInt(fiscal_year as string) : activeFiscalYear;

    let query = supabase
      .from('budget_categories')
      .select('*')
      .eq('fiscal_year', targetFiscalYear);

    if (department_id) {
      query = query.eq('department_id', department_id);
    }

    const { data, error } = await query.order('category_name');
    if (error) throw error;

    res.json(data || []);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/budget/categories - Create budget category (finance/admin only)
router.post('/categories', authenticate, authorize('accounting', 'admin', 'super_admin'), async (req: any, res) => {
  try {
    const { department_id, category_code, category_name, budget_amount, fiscal_year } = req.body;
    const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
    const requestedBudget = toNumber(budget_amount);

    const [{ data: department, error: departmentError }, { data: existingCategories, error: categoriesError }] = await Promise.all([
      supabase
        .from('departments')
        .select('id, annual_budget')
        .eq('id', department_id)
        .single(),
      supabase
        .from('budget_categories')
        .select('budget_amount')
        .eq('department_id', department_id)
        .eq('fiscal_year', fiscal_year || activeFiscalYear)
    ]);

    if (departmentError || !department) {
      return res.status(404).json({ error: 'Department not found' });
    }

    if (categoriesError) throw categoriesError;

    const annualBudget = toNumber(department.annual_budget);
    const allocatedBudget = (existingCategories || []).reduce((sum: number, category: any) => sum + toNumber(category.budget_amount), 0);

    if (allocatedBudget + requestedBudget > annualBudget) {
      return res.status(400).json({
        error: `Category allocation exceeds department budget. Available to allocate: ${Math.max(0, annualBudget - allocatedBudget).toFixed(2)}`
      });
    }

    const { data, error } = await supabase
      .from('budget_categories')
      .insert({
        department_id,
        fiscal_year: fiscal_year || activeFiscalYear,
        category_code: category_code.toUpperCase(),
        category_name,
        budget_amount: requestedBudget,
        remaining_amount: requestedBudget,
        created_at: new Date(),
        updated_at: new Date()
      })
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/budget/categories/:id - Update budget category
router.put('/categories/:id', authenticate, authorize('accounting', 'admin', 'super_admin'), async (req: any, res) => {
  try {
    const { id } = req.params;
    const { budget_amount, category_name } = req.body;

    // Get current category to calculate remaining adjustment
    const { data: current } = await supabase
      .from('budget_categories')
      .select('*')
      .eq('id', id)
      .single();

    if (!current) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const requestedBudget = toNumber(budget_amount || current.budget_amount);
    const usedAmount = toNumber(current.used_amount);
    const committedAmount = toNumber(current.committed_amount);

    const [{ data: department, error: departmentError }, { data: siblingCategories, error: siblingCategoriesError }] = await Promise.all([
      supabase
        .from('departments')
        .select('id, annual_budget')
        .eq('id', current.department_id)
        .single(),
      supabase
        .from('budget_categories')
        .select('id, budget_amount')
        .eq('department_id', current.department_id)
        .eq('fiscal_year', current.fiscal_year)
    ]);

    if (departmentError || !department) {
      return res.status(404).json({ error: 'Department not found' });
    }

    if (siblingCategoriesError) throw siblingCategoriesError;

    const otherAllocatedBudget = (siblingCategories || [])
      .filter((category: any) => category.id !== id)
      .reduce((sum: number, category: any) => sum + toNumber(category.budget_amount), 0);
    const annualBudget = toNumber(department.annual_budget);

    if (otherAllocatedBudget + requestedBudget > annualBudget) {
      return res.status(400).json({
        error: `Category allocation exceeds department budget. Available to allocate: ${Math.max(0, annualBudget - otherAllocatedBudget).toFixed(2)}`
      });
    }

    const newRemaining = requestedBudget - usedAmount - committedAmount;

    const { data, error } = await supabase
      .from('budget_categories')
      .update({
        budget_amount: requestedBudget,
        category_name: category_name || current.category_name,
        remaining_amount: newRemaining,
        updated_at: new Date()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/budget/cost-centers - Get cost centers
router.get('/cost-centers', authenticate, async (req: any, res) => {
  try {
    const { department_id } = req.query;

    let query = supabase
      .from('cost_centers')
      .select('*, departments(name)')
      .eq('is_active', true);

    if (department_id) {
      query = query.eq('department_id', department_id);
    }

    const { data, error } = await query.order('cost_center_code');
    if (error) throw error;

    res.json(data || []);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/budget/cost-centers - Create cost center
router.post('/cost-centers', authenticate, authorize('accounting', 'admin', 'super_admin'), async (req: any, res) => {
  try {
    const { department_id, cost_center_code, cost_center_name, description } = req.body;

    const { data, error } = await supabase
      .from('cost_centers')
      .insert({
        department_id,
        cost_center_code: cost_center_code.toUpperCase(),
        cost_center_name,
        description,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      })
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/budget/monitoring - Budget vs Actual report
router.get('/monitoring', authenticate, authorize('accounting', 'admin', 'super_admin', 'supervisor', 'management'), async (req: any, res) => {
  try {
    const { department_id, fiscal_year } = req.query;
    const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
    const targetFiscalYear = fiscal_year ? parseInt(fiscal_year as string) : activeFiscalYear;

    // Get budget categories with their stats
    let categoriesQuery = supabase
      .from('budget_categories')
      .select(`
        *,
        departments(name)
      `)
      .eq('fiscal_year', targetFiscalYear);

    if (department_id) {
      categoriesQuery = categoriesQuery.eq('department_id', department_id);
    }

    const { data: categories, error: catError } = await categoriesQuery;
    if (catError) throw catError;

    // Get actual expenses (released requests) by category
    const { data: expenses, error: expError } = await supabase
      .from('expense_requests')
      .select(`
        category_id,
        amount,
        status,
        department_id
      `)
      .eq('fiscal_year', targetFiscalYear)
      .eq('status', 'released')
      .not('category_id', 'is', null);

    if (expError) throw expError;

    // Get committed amounts (approved but not released)
    const { data: committed, error: comError } = await supabase
      .from('expense_requests')
      .select(`
        category_id,
        amount,
        department_id
      `)
      .eq('fiscal_year', targetFiscalYear)
      .in('status', ['pending_accounting', 'approved', 'on_hold'])
      .not('category_id', 'is', null);

    if (comError) throw comError;

    // Build budget vs actual report
    const report = (categories || []).map((cat: any) => {
      const categoryExpenses = (expenses || []).filter((e: any) => e.category_id === cat.id);
      const categoryCommitted = (committed || []).filter((c: any) => c.category_id === cat.id);

      const actualAmount = categoryExpenses.reduce((sum: number, e: any) => sum + Number(e.amount), 0);
      const committedAmount = categoryCommitted.reduce((sum: number, c: any) => sum + Number(c.amount), 0);

      return {
        category_id: cat.id,
        category_code: cat.category_code,
        category_name: cat.category_name,
        department_id: cat.department_id,
        department_name: cat.departments?.name || 'Unknown',
        budget: Number(cat.budget_amount),
        actual: actualAmount,
        committed: committedAmount,
        remaining: Number(cat.budget_amount) - actualAmount - committedAmount,
        utilization_pct: Number(cat.budget_amount) > 0 
          ? ((actualAmount + committedAmount) / Number(cat.budget_amount) * 100).toFixed(1)
          : 0
      };
    });

    res.json(report);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/budget/setup - Bulk budget setup for fiscal year
router.post('/setup', authenticate, authorize('accounting', 'admin', 'super_admin'), async (req: any, res) => {
  try {
    const { fiscal_year, department_budgets } = req.body;
    // department_budgets: [{ department_id, categories: [{ category_code, category_name, budget_amount }] }]

    const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
    const targetYear = fiscal_year || activeFiscalYear;

    const createdCategories = [];

    for (const dept of department_budgets) {
      for (const cat of dept.categories) {
        const { data, error } = await supabase
          .from('budget_categories')
          .insert({
            department_id: dept.department_id,
            fiscal_year: targetYear,
            category_code: cat.category_code.toUpperCase(),
            category_name: cat.category_name,
            budget_amount: cat.budget_amount,
            remaining_amount: cat.budget_amount,
            created_at: new Date(),
            updated_at: new Date()
          })
          .select()
          .single();

        if (error) {
          console.error('Error creating category:', error);
          continue;
        }

        createdCategories.push(data);
      }
    }

    res.json({
      message: `Created ${createdCategories.length} budget categories for fiscal year ${targetYear}`,
      categories: createdCategories
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/budget/summary - Finance dashboard summary
router.get('/summary', authenticate, authorize('accounting', 'admin', 'super_admin', 'management'), async (req: any, res) => {
  try {
    const { fiscal_year } = req.query;
    const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
    const targetFiscalYear = fiscal_year ? parseInt(fiscal_year as string) : activeFiscalYear;

    // Get all budget categories for the fiscal year
    const { data: categories, error: catError } = await supabase
      .from('budget_categories')
      .select('*')
      .eq('fiscal_year', targetFiscalYear);

    if (catError) throw catError;

    // Get pending for review count (pending_accounting + on_hold)
    const { data: pending, error: penError } = await supabase
      .from('expense_requests')
      .select('id', { count: 'exact' })
      .eq('fiscal_year', targetFiscalYear)
      .in('status', ['pending_accounting', 'on_hold']);

    if (penError) throw penError;

    // Get outstanding cash advances
    const { data: cashAdvances, error: caError } = await supabase
      .from('cash_advances')
      .select('balance, status')
      .in('status', ['outstanding', 'partially_liquidated', 'overdue']);

    if (caError) throw caError;

    // Get overdue liquidations
    const { data: overdue, error: odError } = await supabase
      .from('cash_advances')
      .select('id', { count: 'exact' })
      .eq('status', 'overdue');

    if (odError) throw odError;

    const totalBudget = (categories || []).reduce((sum: number, c: any) => sum + Number(c.budget_amount), 0);
    const totalUsed = (categories || []).reduce((sum: number, c: any) => sum + Number(c.used_amount), 0);
    const totalCommitted = (categories || []).reduce((sum: number, c: any) => sum + Number(c.committed_amount), 0);
    const totalOutstandingCash = (cashAdvances || []).reduce((sum: number, ca: any) => sum + Number(ca.balance), 0);

    res.json({
      fiscal_year: targetFiscalYear,
      pending_for_review: pending?.length || 0,
      outstanding_cash_advances: totalOutstandingCash,
      overdue_liquidations: overdue?.length || 0,
      budget_utilization_pct: totalBudget > 0 ? ((totalUsed + totalCommitted) / totalBudget * 100).toFixed(1) : 0,
      total_budget: totalBudget,
      total_used: totalUsed,
      total_committed: totalCommitted,
      total_remaining: totalBudget - totalUsed - totalCommitted
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
