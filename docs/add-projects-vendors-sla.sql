-- Add Projects master data table
CREATE TABLE IF NOT EXISTS projects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_code TEXT UNIQUE NOT NULL,
  project_name TEXT NOT NULL,
  description TEXT,
  department_id UUID,
  client_name TEXT,
  start_date DATE,
  end_date DATE,
  budget_allocated DECIMAL(15,2) DEFAULT 0,
  budget_used DECIMAL(15,2) DEFAULT 0,
  status TEXT CHECK (status IN ('active', 'completed', 'on_hold', 'cancelled')) DEFAULT 'active',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_projects_department_id'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT fk_projects_department_id FOREIGN KEY (department_id) REFERENCES departments(id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_project_code ON projects(project_code);
CREATE INDEX IF NOT EXISTS idx_projects_department_id ON projects(department_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

-- Add Vendors master data table
CREATE TABLE IF NOT EXISTS vendors (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_code TEXT UNIQUE NOT NULL,
  vendor_name TEXT NOT NULL,
  contact_person TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  address TEXT,
  tin TEXT,
  vat_registered BOOLEAN DEFAULT false,
  payment_terms TEXT,
  bank_name TEXT,
  bank_account_number TEXT,
  bank_account_name TEXT,
  category TEXT,
  remarks TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_vendor_code ON vendors(vendor_code);
CREATE INDEX IF NOT EXISTS idx_vendors_vendor_name ON vendors(vendor_name);
CREATE INDEX IF NOT EXISTS idx_vendors_category ON vendors(category);

-- Add project_id and vendor_id to expense_requests for tracking
ALTER TABLE expense_requests ADD COLUMN IF NOT EXISTS project_id UUID;
ALTER TABLE expense_requests ADD COLUMN IF NOT EXISTS vendor_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_expense_requests_project_id'
  ) THEN
    ALTER TABLE expense_requests
      ADD CONSTRAINT fk_expense_requests_project_id FOREIGN KEY (project_id) REFERENCES projects(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_expense_requests_vendor_id'
  ) THEN
    ALTER TABLE expense_requests
      ADD CONSTRAINT fk_expense_requests_vendor_id FOREIGN KEY (vendor_id) REFERENCES vendors(id);
  END IF;
END $$;

-- Add SLA policies table for liquidation deadlines
CREATE TABLE IF NOT EXISTS sla_policies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  policy_name TEXT NOT NULL,
  policy_type TEXT CHECK (policy_type IN ('liquidation', 'approval', 'receipt_submission', 'escalation')) NOT NULL,
  trigger_condition TEXT NOT NULL,
  deadline_days INT NOT NULL,
  escalation_action TEXT,
  escalation_user_id UUID,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sla_policies_type ON sla_policies(policy_type);
CREATE INDEX IF NOT EXISTS idx_sla_policies_active ON sla_policies(is_active);

-- Insert default SLA policies
INSERT INTO sla_policies (policy_name, policy_type, trigger_condition, deadline_days, escalation_action) VALUES
  ('Cash Advance Liquidation', 'liquidation', 'cash_advance_released', 15, 'notify_supervisor'),
  ('Receipt Submission', 'receipt_submission', 'expense_incurred', 5, 'reminder'),
  ('Supervisor Approval', 'approval', 'request_submitted', 3, 'escalate_to_finance'),
  ('Finance Approval', 'approval', 'supervisor_approved', 5, 'auto_approve')
ON CONFLICT DO NOTHING;

-- Add budget_alerts table for over-budget notifications
CREATE TABLE IF NOT EXISTS budget_alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  department_id UUID,
  project_id UUID,
  alert_type TEXT CHECK (alert_type IN ('threshold_warning', 'over_budget', 'threshold_exceeded')) NOT NULL,
  threshold_percentage INT DEFAULT 80,
  current_percentage DECIMAL(5,2) DEFAULT 0,
  amount_over DECIMAL(15,2) DEFAULT 0,
  status TEXT CHECK (status IN ('active', 'acknowledged', 'resolved')) DEFAULT 'active',
  acknowledged_by UUID,
  acknowledged_at TIMESTAMP,
  resolution_note TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_budget_alerts_department_id'
  ) THEN
    ALTER TABLE budget_alerts
      ADD CONSTRAINT fk_budget_alerts_department_id FOREIGN KEY (department_id) REFERENCES departments(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_budget_alerts_project_id'
  ) THEN
    ALTER TABLE budget_alerts
      ADD CONSTRAINT fk_budget_alerts_project_id FOREIGN KEY (project_id) REFERENCES projects(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_budget_alerts_department ON budget_alerts(department_id);
CREATE INDEX IF NOT EXISTS idx_budget_alerts_status ON budget_alerts(status);

-- Add request_type field to differentiate reimbursement from cash advance
ALTER TABLE expense_requests ADD COLUMN IF NOT EXISTS request_type TEXT CHECK (request_type IN ('reimbursement', 'cash_advance', 'direct_expense')) DEFAULT 'reimbursement';

-- Add business justification fields for reimbursement
ALTER TABLE expense_requests ADD COLUMN IF NOT EXISTS business_reason TEXT;
ALTER TABLE expense_requests ADD COLUMN IF NOT EXISTS receipt_required BOOLEAN DEFAULT true;
ALTER TABLE expense_requests ADD COLUMN IF NOT EXISTS receipt_submitted_at TIMESTAMP;
