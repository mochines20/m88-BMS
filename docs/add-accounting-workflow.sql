-- Adds accounting-focused workflow support for:
-- 1. liquidation workflow
-- 2. supporting document attachments
-- 3. disbursement/release tracking
-- 4. detailed audit trail
-- 5. return for revision flow

ALTER TABLE expense_requests
  ADD COLUMN IF NOT EXISTS disbursement_status TEXT CHECK (disbursement_status IN ('pending', 'scheduled', 'released', 'cancelled')) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS release_method TEXT CHECK (release_method IN ('cash', 'bank_transfer', 'check', 'petty_cash', 'other')),
  ADD COLUMN IF NOT EXISTS release_reference_no TEXT,
  ADD COLUMN IF NOT EXISTS release_note TEXT,
  ADD COLUMN IF NOT EXISTS released_by UUID,
  ADD COLUMN IF NOT EXISTS released_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS returned_by UUID,
  ADD COLUMN IF NOT EXISTS returned_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS return_reason TEXT,
  ADD COLUMN IF NOT EXISTS revision_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'expense_requests_status_check'
  ) THEN
    ALTER TABLE expense_requests
      ADD CONSTRAINT expense_requests_status_check
      CHECK (status IN ('draft', 'pending_supervisor', 'pending_accounting', 'approved', 'rejected', 'returned_for_revision', 'released'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_expense_requests_released_by'
  ) THEN
    ALTER TABLE expense_requests
      ADD CONSTRAINT fk_expense_requests_released_by FOREIGN KEY (released_by) REFERENCES users(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_expense_requests_returned_by'
  ) THEN
    ALTER TABLE expense_requests
      ADD CONSTRAINT fk_expense_requests_returned_by FOREIGN KEY (returned_by) REFERENCES users(id);
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
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_request_liquidations_request_id'
  ) THEN
    ALTER TABLE request_liquidations
      ADD CONSTRAINT fk_request_liquidations_request_id FOREIGN KEY (request_id) REFERENCES expense_requests(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_request_liquidations_created_by'
  ) THEN
    ALTER TABLE request_liquidations
      ADD CONSTRAINT fk_request_liquidations_created_by FOREIGN KEY (created_by) REFERENCES users(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_request_liquidations_reviewed_by'
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
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_request_attachments_request_id'
  ) THEN
    ALTER TABLE request_attachments
      ADD CONSTRAINT fk_request_attachments_request_id FOREIGN KEY (request_id) REFERENCES expense_requests(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_request_attachments_liquidation_id'
  ) THEN
    ALTER TABLE request_attachments
      ADD CONSTRAINT fk_request_attachments_liquidation_id FOREIGN KEY (liquidation_id) REFERENCES request_liquidations(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_request_attachments_uploaded_by'
  ) THEN
    ALTER TABLE request_attachments
      ADD CONSTRAINT fk_request_attachments_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users(id);
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
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_request_audit_logs_request_id'
  ) THEN
    ALTER TABLE request_audit_logs
      ADD CONSTRAINT fk_request_audit_logs_request_id FOREIGN KEY (request_id) REFERENCES expense_requests(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_request_audit_logs_actor_id'
  ) THEN
    ALTER TABLE request_audit_logs
      ADD CONSTRAINT fk_request_audit_logs_actor_id FOREIGN KEY (actor_id) REFERENCES users(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_expense_requests_disbursement_status ON expense_requests(disbursement_status);
CREATE INDEX IF NOT EXISTS idx_expense_requests_released_at ON expense_requests(released_at);
CREATE INDEX IF NOT EXISTS idx_request_liquidations_request_id ON request_liquidations(request_id);
CREATE INDEX IF NOT EXISTS idx_request_liquidations_status ON request_liquidations(status);
CREATE INDEX IF NOT EXISTS idx_request_liquidations_due_at ON request_liquidations(due_at);
CREATE INDEX IF NOT EXISTS idx_request_attachments_request_id ON request_attachments(request_id);
CREATE INDEX IF NOT EXISTS idx_request_attachments_liquidation_id ON request_attachments(liquidation_id);
CREATE INDEX IF NOT EXISTS idx_request_audit_logs_request_id ON request_audit_logs(request_id);
CREATE INDEX IF NOT EXISTS idx_request_audit_logs_created_at ON request_audit_logs(created_at);
