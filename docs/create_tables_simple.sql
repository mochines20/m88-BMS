-- Step 1: Create tables WITHOUT foreign keys first

CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  role TEXT NOT NULL,
  department_id UUID,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS departments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT,
  fiscal_year INTEGER DEFAULT EXTRACT(YEAR FROM CURRENT_DATE),
  monthly_budget DECIMAL(15,2) DEFAULT 0,
  remaining_budget DECIMAL(15,2) DEFAULT 0,
  petty_cash_balance DECIMAL(15,2) DEFAULT 0,
  head_id UUID,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  category_code TEXT NOT NULL,
  category_name TEXT NOT NULL,
  department_id UUID,
  budget_amount DECIMAL(15,2) DEFAULT 0,
  allocated_amount DECIMAL(15,2) DEFAULT 0,
  remaining_amount DECIMAL(15,2) DEFAULT 0,
  fiscal_year INTEGER DEFAULT EXTRACT(YEAR FROM CURRENT_DATE),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cost_centers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  department_id UUID,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create expense_requests with co-approval columns, no FKs yet
CREATE TABLE IF NOT EXISTS expense_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  request_code TEXT UNIQUE NOT NULL,
  employee_id UUID,
  request_type TEXT NOT NULL,
  category_id UUID,
  item_name TEXT,
  department_id UUID,
  amount DECIMAL(15,2) NOT NULL,
  currency TEXT DEFAULT 'PHP',
  description TEXT,
  purpose TEXT,
  business_purpose TEXT,
  expense_date DATE,
  expected_use_date DATE,
  expected_liquidation_date DATE,
  receipt_url TEXT,
  cost_center_id UUID,
  project TEXT,
  priority TEXT DEFAULT 'normal',
  status TEXT DEFAULT 'draft',
  on_hold_reason TEXT,
  returned_reason TEXT,
  rejected_reason TEXT,
  approved_by UUID,
  approved_at TIMESTAMP,
  rejected_by UUID,
  rejected_at TIMESTAMP,
  released_by UUID,
  released_at TIMESTAMP,
  returned_by UUID,
  returned_at TIMESTAMP,
  on_hold_at TIMESTAMP,
  on_hold_by UUID,
  co_approved_by UUID,
  co_approved_at TIMESTAMP,
  co_approver_role TEXT,
  submitted_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT NOW()
);

SELECT 'All tables created without foreign keys' as step1;
