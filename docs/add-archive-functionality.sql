-- Add archived field to expense_requests table
ALTER TABLE expense_requests
ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE;

-- Add index for archived requests
CREATE INDEX IF NOT EXISTS idx_expense_requests_archived
ON expense_requests (archived);

-- Add index for archived and status combination
CREATE INDEX IF NOT EXISTS idx_expense_requests_archived_status
ON expense_requests (archived, status);