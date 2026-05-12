-- Add reconciliation columns to expense_requests
-- Run this in Supabase SQL Editor

ALTER TABLE expense_requests
  ADD COLUMN IF NOT EXISTS reconciled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS discrepancy_note text,
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciled_by uuid REFERENCES users(id) ON DELETE SET NULL;
