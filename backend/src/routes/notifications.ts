import express from 'express';
import { supabase } from '../utils/supabase';
import { authenticate } from '../middleware/auth';

const router = express.Router();

// GET /api/notifications - Get user's notifications
router.get('/', authenticate, async (req: any, res) => {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('Supabase error in notifications:', error);
      return res.status(400).json({ error });
    }
    
    res.json(data || []);
  } catch (error: any) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/notifications/:id/read - Mark notification as read
router.patch('/:id/read', authenticate, async (req: any, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id)
      .eq('user_id', req.user.id)
      .select()
      .single();

    if (error) {
      console.error('Supabase error updating notification:', error);
      return res.status(400).json({ error });
    }
    
    res.json(data);
  } catch (error: any) {
    console.error('Error updating notification:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
