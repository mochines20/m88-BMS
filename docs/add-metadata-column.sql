-- Add metadata column to expense_requests table
ALTER TABLE expense_requests ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
