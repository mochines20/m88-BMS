-- Migration: Add co-approval columns to expense_requests
-- Run this in Supabase SQL Editor

-- First, check if table exists and create if not
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'expense_requests'
  ) THEN
    RAISE EXCEPTION 'Table expense_requests does not exist. Please run the full schema.sql first.';
  END IF;
END $$;

-- Add co-approval columns if they don't exist
ALTER TABLE expense_requests
  ADD COLUMN IF NOT EXISTS co_approved_by UUID,
  ADD COLUMN IF NOT EXISTS co_approved_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS co_approver_role TEXT;

-- Add foreign key constraint separately (only if column was just added)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_expense_requests_co_approved_by'
  ) THEN
    ALTER TABLE expense_requests
      ADD CONSTRAINT fk_expense_requests_co_approved_by 
      FOREIGN KEY (co_approved_by) REFERENCES users(id);
  END IF;
END $$;

-- Verify columns were added
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_schema = 'public' 
AND table_name = 'expense_requests'
AND column_name IN ('co_approved_by', 'co_approved_at', 'co_approver_role');
