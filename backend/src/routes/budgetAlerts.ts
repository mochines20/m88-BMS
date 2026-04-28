import express from 'express';
import { supabase } from '../utils/supabase';

const router = express.Router();

const toNumber = (value: unknown) => Number.parseFloat(String(value ?? 0)) || 0;

router.get('/', async (req, res) => {
  try {
    const { department_id, status, alert_type } = req.query;

    let query = supabase
      .from('budget_alerts')
      .select(`
        *,
        departments:departments!fk_budget_alerts_department_id(id, name),
        projects:projects!fk_budget_alerts_project_id(id, project_name)
      `)
      .order('created_at', { ascending: false });

    if (department_id) {
      query = query.eq('department_id', department_id);
    }

    if (status) {
      query = query.eq('status', status);
    }

    if (alert_type) {
      query = query.eq('alert_type', alert_type);
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json({ alerts: data || [] });
  } catch (error: any) {
    console.error('Error fetching budget alerts:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/check', async (req, res) => {
  try {
    const { department_id } = req.query;
    const thresholdWarning = 80;
    const thresholdExceeded = 100;

    let query = supabase
      .from('departments')
      .select('id, name, annual_budget, used_budget, fiscal_year')
      .eq('fiscal_year', new Date().getFullYear());

    if (department_id) {
      query = query.eq('id', department_id);
    }

    const { data: departments, error } = await query;

    if (error) throw error;

    const alerts = [];

    for (const dept of (departments || [])) {
      const annualBudget = toNumber(dept.annual_budget);
      const usedBudget = toNumber(dept.used_budget);
      const percentage = annualBudget > 0 ? (usedBudget / annualBudget) * 100 : 0;

      if (percentage >= thresholdWarning) {
        const alertType = percentage >= thresholdExceeded ? 'over_budget' : 'threshold_warning';

        const { data: existingAlert } = await supabase
          .from('budget_alerts')
          .select('id')
          .eq('department_id', dept.id)
          .eq('alert_type', alertType)
          .eq('status', 'active')
          .single();

        if (!existingAlert) {
          const { data: newAlert, error: insertError } = await supabase
            .from('budget_alerts')
            .insert({
              department_id: dept.id,
              alert_type: alertType,
              threshold_percentage: alertType === 'over_budget' ? 100 : thresholdWarning,
              current_percentage: percentage,
              amount_over: alertType === 'over_budget' ? usedBudget - annualBudget : 0,
              status: 'active'
            })
            .select()
            .single();

          if (!insertError && newAlert) {
            alerts.push({ ...newAlert, department_name: dept.name });
          }
        }
      }
    }

    res.json({
      checked: departments?.length || 0,
      alerts_generated: alerts.length,
      alerts
    });
  } catch (error: any) {
    console.error('Error checking budget alerts:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id/acknowledge', async (req, res) => {
  try {
    const { id } = req.params;
    const { resolution_note } = req.body;

    const { data, error } = await supabase
      .from('budget_alerts')
      .update({
        status: 'acknowledged',
        acknowledged_at: new Date().toISOString(),
        resolution_note
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Alert not found' });

    res.json(data);
  } catch (error: any) {
    console.error('Error acknowledging budget alert:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id/resolve', async (req, res) => {
  try {
    const { id } = req.params;
    const { resolution_note } = req.body;

    const { data, error } = await supabase
      .from('budget_alerts')
      .update({
        status: 'resolved',
        resolution_note,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Alert not found' });

    res.json(data);
  } catch (error: any) {
    console.error('Error resolving budget alert:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/summary', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('budget_alerts')
      .select('status, alert_type')
      .eq('is_active', true);

    if (error) throw error;

    const summary = {
      total: data?.length || 0,
      by_status: {} as Record<string, number>,
      by_type: {} as Record<string, number>
    };

    for (const alert of (data || [])) {
      summary.by_status[alert.status] = (summary.by_status[alert.status] || 0) + 1;
      summary.by_type[alert.alert_type] = (summary.by_type[alert.alert_type] || 0) + 1;
    }

    res.json(summary);
  } catch (error: any) {
    console.error('Error fetching budget alerts summary:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
