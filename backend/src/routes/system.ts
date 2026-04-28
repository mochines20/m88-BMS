import express from 'express';
import { supabase } from '../utils/supabase';
import { authenticate } from '../middleware/auth';

const router = express.Router();

// System health check endpoint
router.get('/health', authenticate, async (req, res) => {
  try {
    // Check Supabase connection
    const { data: supabaseCheck, error: supabaseError } = await supabase
      .from('departments')
      .select('count')
      .limit(1);

    const supabaseHealthy = !supabaseError && supabaseCheck !== null;

    // Get system statistics
    const [
      departmentsResult,
      usersResult,
      requestsResult,
      expensesResult
    ] = await Promise.all([
      supabase.from('departments').select('*', { count: 'exact', head: true }),
      supabase.from('users').select('*', { count: 'exact', head: true }),
      supabase.from('requests').select('*', { count: 'exact', head: true }),
      supabase.from('expenses').select('*', { count: 'exact', head: true })
    ]);

    const stats = {
      timestamp: new Date().toISOString(),
      supabase: {
        status: supabaseHealthy ? 'healthy' : 'unhealthy',
        error: supabaseError?.message || null
      },
      counts: {
        departments: departmentsResult.count || 0,
        users: usersResult.count || 0,
        requests: requestsResult.count || 0,
        expenses: expensesResult.count || 0
      },
      backend: {
        status: 'healthy',
        uptime: process.uptime()
      }
    };

    res.json(stats);
  } catch (error: any) {
    res.status(500).json({
      timestamp: new Date().toISOString(),
      supabase: {
        status: 'unhealthy',
        error: error?.message || 'Unknown error'
      },
      backend: {
        status: 'degraded',
        uptime: process.uptime()
      },
      counts: {
        departments: 0,
        users: 0,
        requests: 0,
        expenses: 0
      }
    });
  }
});

export default router;
