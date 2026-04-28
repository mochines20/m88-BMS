import express from 'express';
import { supabase } from '../utils/supabase';

const router = express.Router();

const toText = (value: unknown) => String(value ?? '').trim();
const toNumber = (value: unknown) => Number.parseFloat(String(value ?? 0)) || 0;

router.get('/', async (req, res) => {
  try {
    const { category, search, page = 1, limit = 50 } = req.query;

    let query = supabase
      .from('vendors')
      .select('*', { count: 'exact' })
      .eq('is_active', true);

    if (category) {
      query = query.eq('category', category);
    }

    if (search) {
      query = query.or(`vendor_code.ilike.%${search}%,vendor_name.ilike.%${search}%,contact_person.ilike.%${search}%`);
    }

    const offset = (Number(page) - 1) * Number(limit);
    query = query.range(offset, offset + Number(limit) - 1);
    query = query.order('vendor_name', { ascending: true });

    const { data, error, count } = await query;

    if (error) throw error;

    res.json({ vendors: data || [], total: count || 0 });
  } catch (error: any) {
    console.error('Error fetching vendors:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('vendors')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Vendor not found' });

    res.json(data);
  } catch (error: any) {
    console.error('Error fetching vendor:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const {
      vendor_code,
      vendor_name,
      contact_person,
      contact_email,
      contact_phone,
      address,
      tin,
      vat_registered,
      payment_terms,
      bank_name,
      bank_account_number,
      bank_account_name,
      category,
      remarks
    } = req.body;

    if (!vendor_code || !vendor_name) {
      return res.status(400).json({ error: 'Vendor code and name are required' });
    }

    const { data, error } = await supabase
      .from('vendors')
      .insert({
        vendor_code: toText(vendor_code),
        vendor_name: toText(vendor_name),
        contact_person: toText(contact_person),
        contact_email: toText(contact_email),
        contact_phone: toText(contact_phone),
        address: toText(address),
        tin: toText(tin),
        vat_registered: vat_registered || false,
        payment_terms: toText(payment_terms),
        bank_name: toText(bank_name),
        bank_account_number: toText(bank_account_number),
        bank_account_name: toText(bank_account_name),
        category: toText(category),
        remarks: toText(remarks)
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (error: any) {
    console.error('Error creating vendor:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const allowedFields = [
      'vendor_name', 'contact_person', 'contact_email', 'contact_phone',
      'address', 'tin', 'vat_registered', 'payment_terms',
      'bank_name', 'bank_account_number', 'bank_account_name',
      'category', 'remarks', 'is_active'
    ];

    const sanitizedUpdates: Record<string, any> = {};
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        sanitizedUpdates[field] = updates[field];
      }
    }

    sanitizedUpdates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('vendors')
      .update(sanitizedUpdates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Vendor not found' });

    res.json(data);
  } catch (error: any) {
    console.error('Error updating vendor:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('vendors')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw error;

    res.json({ message: 'Vendor deactivated successfully' });
  } catch (error: any) {
    console.error('Error deactivating vendor:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
