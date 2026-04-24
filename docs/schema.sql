-- Create the database schema for Madison88 Budget Management System

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT CHECK (role IN ('employee', 'supervisor', 'accounting', 'admin')) NOT NULL,
  department_id UUID,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  last_sent_at TIMESTAMP DEFAULT NOW(),
  used_at TIMESTAMP,
  invalidated_at TIMESTAMP,
  invalidation_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Departments table
CREATE TABLE IF NOT EXISTS departments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  annual_budget DECIMAL(15,2) DEFAULT 0,
  used_budget DECIMAL(15,2) DEFAULT 0,
  petty_cash_balance DECIMAL(15,2) DEFAULT 0,
  fiscal_year INT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add foreign key for users
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_department_id'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT fk_users_department_id FOREIGN KEY (department_id) REFERENCES departments(id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS departments_name_fiscal_year_unique_idx
ON departments (LOWER(TRIM(name)), fiscal_year);

-- Expense Requests table
CREATE TABLE IF NOT EXISTS expense_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  request_code TEXT UNIQUE NOT NULL,
  employee_id UUID,
  department_id UUID,
  fiscal_year INT,
  item_name TEXT NOT NULL,
  category TEXT NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  purpose TEXT,
  priority TEXT CHECK (priority IN ('normal', 'urgent', 'low')) DEFAULT 'normal',
  status TEXT CHECK (status IN ('draft', 'pending_supervisor', 'pending_accounting', 'approved', 'rejected', 'returned_for_revision', 'released')) DEFAULT 'draft',
  disbursement_status TEXT CHECK (disbursement_status IN ('pending', 'scheduled', 'released', 'cancelled')) DEFAULT 'pending',
  release_method TEXT CHECK (release_method IN ('cash', 'bank_transfer', 'check', 'petty_cash', 'other')),
  release_reference_no TEXT,
  release_note TEXT,
  released_by UUID,
  released_at TIMESTAMP,
  returned_by UUID,
  returned_at TIMESTAMP,
  return_reason TEXT,
  revision_count INT DEFAULT 0,
  rejection_reason TEXT,
  rejection_stage TEXT CHECK (rejection_stage IN ('supervisor', 'accounting')),
  submitted_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add foreign keys for expense_requests
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_expense_requests_employee_id'
  ) THEN
    ALTER TABLE expense_requests
      ADD CONSTRAINT fk_expense_requests_employee_id FOREIGN KEY (employee_id) REFERENCES users(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_expense_requests_department_id'
  ) THEN
    ALTER TABLE expense_requests
      ADD CONSTRAINT fk_expense_requests_department_id FOREIGN KEY (department_id) REFERENCES departments(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_expense_requests_released_by'
  ) THEN
    ALTER TABLE expense_requests
      ADD CONSTRAINT fk_expense_requests_released_by FOREIGN KEY (released_by) REFERENCES users(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_expense_requests_returned_by'
  ) THEN
    ALTER TABLE expense_requests
      ADD CONSTRAINT fk_expense_requests_returned_by FOREIGN KEY (returned_by) REFERENCES users(id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS request_allocations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id UUID,
  department_id UUID,
  amount DECIMAL(15,2) NOT NULL,
  created_by UUID,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add foreign keys for request_allocations
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_request_allocations_request_id'
  ) THEN
    ALTER TABLE request_allocations
      ADD CONSTRAINT fk_request_allocations_request_id FOREIGN KEY (request_id) REFERENCES expense_requests(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_request_allocations_department_id'
  ) THEN
    ALTER TABLE request_allocations
      ADD CONSTRAINT fk_request_allocations_department_id FOREIGN KEY (department_id) REFERENCES departments(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_request_allocations_created_by'
  ) THEN
    ALTER TABLE request_allocations
      ADD CONSTRAINT fk_request_allocations_created_by FOREIGN KEY (created_by) REFERENCES users(id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS request_liquidations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id UUID NOT NULL,
  liquidation_no TEXT UNIQUE NOT NULL,
  status TEXT CHECK (status IN ('pending_submission', 'submitted', 'returned', 'verified', 'overdue')) DEFAULT 'pending_submission',
  due_at TIMESTAMP,
  submitted_at TIMESTAMP,
  reviewed_at TIMESTAMP,
  actual_amount DECIMAL(15,2),
  reimbursable_amount DECIMAL(15,2) DEFAULT 0,
  cash_return_amount DECIMAL(15,2) DEFAULT 0,
  shortage_amount DECIMAL(15,2) DEFAULT 0,
  remarks TEXT,
  created_by UUID,
  reviewed_by UUID,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_request_liquidations_request_id'
  ) THEN
    ALTER TABLE request_liquidations
      ADD CONSTRAINT fk_request_liquidations_request_id FOREIGN KEY (request_id) REFERENCES expense_requests(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_request_liquidations_created_by'
  ) THEN
    ALTER TABLE request_liquidations
      ADD CONSTRAINT fk_request_liquidations_created_by FOREIGN KEY (created_by) REFERENCES users(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_request_liquidations_reviewed_by'
  ) THEN
    ALTER TABLE request_liquidations
      ADD CONSTRAINT fk_request_liquidations_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES users(id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS request_attachments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id UUID NOT NULL,
  liquidation_id UUID,
  attachment_scope TEXT CHECK (attachment_scope IN ('request', 'disbursement', 'liquidation')) DEFAULT 'request',
  attachment_type TEXT,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  storage_bucket TEXT,
  storage_path TEXT,
  mime_type TEXT,
  file_size_bytes BIGINT,
  uploaded_by UUID,
  uploaded_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_request_attachments_request_id'
  ) THEN
    ALTER TABLE request_attachments
      ADD CONSTRAINT fk_request_attachments_request_id FOREIGN KEY (request_id) REFERENCES expense_requests(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_request_attachments_liquidation_id'
  ) THEN
    ALTER TABLE request_attachments
      ADD CONSTRAINT fk_request_attachments_liquidation_id FOREIGN KEY (liquidation_id) REFERENCES request_liquidations(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_request_attachments_uploaded_by'
  ) THEN
    ALTER TABLE request_attachments
      ADD CONSTRAINT fk_request_attachments_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users(id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS allocation_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id UUID,
  actor_id UUID,
  action TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Add foreign keys for allocation_logs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_allocation_logs_request_id'
  ) THEN
    ALTER TABLE allocation_logs
      ADD CONSTRAINT fk_allocation_logs_request_id FOREIGN KEY (request_id) REFERENCES expense_requests(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_allocation_logs_actor_id'
  ) THEN
    ALTER TABLE allocation_logs
      ADD CONSTRAINT fk_allocation_logs_actor_id FOREIGN KEY (actor_id) REFERENCES users(id);
  END IF;
END $$;

-- Approval Log (Audit Trail) table
CREATE TABLE IF NOT EXISTS approval_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id UUID,
  actor_id UUID,
  action TEXT CHECK (action IN ('submitted', 'approved', 'rejected', 'returned', 'forwarded', 'released', 'comment')) NOT NULL,
  stage TEXT CHECK (stage IN ('supervisor', 'accounting', 'finance')) NOT NULL,
  note TEXT,
  timestamp TIMESTAMP DEFAULT NOW()
);

-- Add foreign keys for approval_logs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_approval_logs_request_id'
  ) THEN
    ALTER TABLE approval_logs
      ADD CONSTRAINT fk_approval_logs_request_id FOREIGN KEY (request_id) REFERENCES expense_requests(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_approval_logs_actor_id'
  ) THEN
    ALTER TABLE approval_logs
      ADD CONSTRAINT fk_approval_logs_actor_id FOREIGN KEY (actor_id) REFERENCES users(id);
  END IF;
END $$;

-- Direct Expenses table
CREATE TABLE IF NOT EXISTS direct_expenses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  department_id UUID,
  logged_by UUID,
  item_name TEXT NOT NULL,
  category TEXT NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  description TEXT,
  expense_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Add foreign keys for direct_expenses
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_direct_expenses_department_id'
  ) THEN
    ALTER TABLE direct_expenses
      ADD CONSTRAINT fk_direct_expenses_department_id FOREIGN KEY (department_id) REFERENCES departments(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_direct_expenses_logged_by'
  ) THEN
    ALTER TABLE direct_expenses
      ADD CONSTRAINT fk_direct_expenses_logged_by FOREIGN KEY (logged_by) REFERENCES users(id);
  END IF;
END $$;

-- Petty Cash Transactions table
CREATE TABLE IF NOT EXISTS petty_cash_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  department_id UUID,
  managed_by UUID,
  type TEXT CHECK (type IN ('replenishment', 'disbursement')) NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  purpose TEXT,
  reference_request_id UUID,
  transaction_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Add foreign keys for petty_cash_transactions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_petty_cash_transactions_department_id'
  ) THEN
    ALTER TABLE petty_cash_transactions
      ADD CONSTRAINT fk_petty_cash_transactions_department_id FOREIGN KEY (department_id) REFERENCES departments(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_petty_cash_transactions_managed_by'
  ) THEN
    ALTER TABLE petty_cash_transactions
      ADD CONSTRAINT fk_petty_cash_transactions_managed_by FOREIGN KEY (managed_by) REFERENCES users(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_petty_cash_transactions_reference_request_id'
  ) THEN
    ALTER TABLE petty_cash_transactions
      ADD CONSTRAINT fk_petty_cash_transactions_reference_request_id FOREIGN KEY (reference_request_id) REFERENCES expense_requests(id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS request_audit_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id UUID NOT NULL,
  actor_id UUID,
  entity_type TEXT CHECK (entity_type IN ('request', 'allocation', 'attachment', 'liquidation', 'release')) NOT NULL,
  action TEXT NOT NULL,
  field_name TEXT,
  old_value TEXT,
  new_value TEXT,
  note TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_request_audit_logs_request_id'
  ) THEN
    ALTER TABLE request_audit_logs
      ADD CONSTRAINT fk_request_audit_logs_request_id FOREIGN KEY (request_id) REFERENCES expense_requests(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_request_audit_logs_actor_id'
  ) THEN
    ALTER TABLE request_audit_logs
      ADD CONSTRAINT fk_request_audit_logs_actor_id FOREIGN KEY (actor_id) REFERENCES users(id);
  END IF;
END $$;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_expense_requests_status ON expense_requests(status);
CREATE INDEX IF NOT EXISTS idx_expense_requests_department_id ON expense_requests(department_id);
CREATE INDEX IF NOT EXISTS idx_expense_requests_fiscal_year ON expense_requests(fiscal_year);
CREATE INDEX IF NOT EXISTS idx_expense_requests_submitted_at ON expense_requests(submitted_at);
CREATE INDEX IF NOT EXISTS idx_expense_requests_disbursement_status ON expense_requests(disbursement_status);
CREATE INDEX IF NOT EXISTS idx_expense_requests_released_at ON expense_requests(released_at);
CREATE INDEX IF NOT EXISTS idx_request_allocations_request_id ON request_allocations(request_id);
CREATE INDEX IF NOT EXISTS idx_request_allocations_department_id ON request_allocations(department_id);
CREATE INDEX IF NOT EXISTS idx_request_liquidations_request_id ON request_liquidations(request_id);
CREATE INDEX IF NOT EXISTS idx_request_liquidations_status ON request_liquidations(status);
CREATE INDEX IF NOT EXISTS idx_request_liquidations_due_at ON request_liquidations(due_at);
CREATE INDEX IF NOT EXISTS idx_request_attachments_request_id ON request_attachments(request_id);
CREATE INDEX IF NOT EXISTS idx_request_attachments_liquidation_id ON request_attachments(liquidation_id);
CREATE INDEX IF NOT EXISTS idx_allocation_logs_request_id ON allocation_logs(request_id);
CREATE INDEX IF NOT EXISTS idx_approval_logs_request_id ON approval_logs(request_id);
CREATE INDEX IF NOT EXISTS idx_request_audit_logs_request_id ON request_audit_logs(request_id);
CREATE INDEX IF NOT EXISTS idx_request_audit_logs_created_at ON request_audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_direct_expenses_department_id ON direct_expenses(department_id);
CREATE INDEX IF NOT EXISTS idx_petty_cash_department_id ON petty_cash_transactions(department_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_active_lookup ON password_reset_tokens(user_id, expires_at);
