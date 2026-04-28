import express from 'express';
import { supabase } from '../utils/supabase';

const router = express.Router();

const toText = (value: unknown) => String(value ?? '').trim();
const toNumber = (value: unknown) => Number.parseFloat(String(value ?? 0)) || 0;

router.get('/', async (req, res) => {
  try {
    const { department_id, status, search, page = 1, limit = 50 } = req.query;

    let query = supabase
      .from('projects')
      .select('*', { count: 'exact' })
      .eq('is_active', true);

    if (department_id) {
      query = query.eq('department_id', department_id);
    }

    if (status) {
      query = query.eq('status', status);
    }

    if (search) {
      query = query.or(`project_code.ilike.%${search}%,project_name.ilike.%${search}%`);
    }

    const offset = (Number(page) - 1) * Number(limit);
    query = query.range(offset, offset + Number(limit) - 1);
    query = query.order('created_at', { ascending: false });

    const { data, error, count } = await query;

    if (error) throw error;

    res.json({ projects: data || [], total: count || 0 });
  } catch (error: any) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('projects')
      .select(`
        *,
        departments:departments!fk_projects_department_id(id, name, fiscal_year)
      `)
      .eq('id', id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Project not found' });

    res.json(data);
  } catch (error: any) {
    console.error('Error fetching project:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const {
      project_code,
      project_name,
      description,
      department_id,
      client_name,
      start_date,
      end_date,
      budget_allocated,
      status = 'active'
    } = req.body;

    if (!project_code || !project_name) {
      return res.status(400).json({ error: 'Project code and name are required' });
    }

    const { data, error } = await supabase
      .from('projects')
      .insert({
        project_code: toText(project_code),
        project_name: toText(project_name),
        description: toText(description),
        department_id: department_id || null,
        client_name: toText(client_name),
        start_date: start_date || null,
        end_date: end_date || null,
        budget_allocated: toNumber(budget_allocated),
        status
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (error: any) {
    console.error('Error creating project:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const allowedFields = [
      'project_name', 'description', 'department_id', 'client_name',
      'start_date', 'end_date', 'budget_allocated', 'status', 'is_active'
    ];

    const sanitizedUpdates: Record<string, any> = {};
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        sanitizedUpdates[field] = updates[field];
      }
    }

    sanitizedUpdates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('projects')
      .update(sanitizedUpdates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Project not found' });

    res.json(data);
  } catch (error: any) {
    console.error('Error updating project:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('projects')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw error;

    res.json({ message: 'Project deactivated successfully' });
  } catch (error: any) {
    console.error('Error deactivating project:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/budget-summary', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('budget_allocated, budget_used')
      .eq('id', id)
      .single();

    if (projectError) throw projectError;
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const { data: requests } = await supabase
      .from('expense_requests')
      .select('amount, status')
      .eq('project_id', id)
      .in('status', ['approved', 'released']);

    const totalSpent = (requests || []).reduce((sum: number, req: any) => sum + toNumber(req.amount), 0);

    res.json({
      budget_allocated: toNumber(project.budget_allocated),
      budget_used: toNumber(project.budget_used),
      total_spent: totalSpent,
      remaining: toNumber(project.budget_allocated) - totalSpent,
      utilization_percentage: project.budget_allocated > 0
        ? (totalSpent / toNumber(project.budget_allocated)) * 100
        : 0
    });
  } catch (error: any) {
    console.error('Error fetching project budget summary:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
