-- Migration: Add 'on_hold' status to expense_requests status constraint
-- This fixes the error: "new row for relation expense_requests violates check constraint expense_requests_status_check"

-- Drop existing constraint
ALTER TABLE expense_requests
  DROP CONSTRAINT IF EXISTS expense_requests_status_check;

-- Add updated constraint with 'on_hold' included
ALTER TABLE expense_requests
  ADD CONSTRAINT expense_requests_status_check
  CHECK (
    status IN (
      'draft',
      'pending_supervisor',
      'pending_accounting',
      'approved',
      'rejected',
      'returned_for_revision',
      'released',
      'on_hold'  -- NEW: Added for accounting hold functionality
    )
  );

-- Also need to update the on_hold columns if they don't exist
DO $$
BEGIN
  -- Add on_hold_at column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'expense_requests' AND column_name = 'on_hold_at'
  ) THEN
    ALTER TABLE expense_requests ADD COLUMN on_hold_at TIMESTAMP;
  END IF;

  -- Add on_hold_by column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'expense_requests' AND column_name = 'on_hold_by'
  ) THEN
    ALTER TABLE expense_requests ADD COLUMN on_hold_by UUID REFERENCES users(id);
  END IF;
END $$;
