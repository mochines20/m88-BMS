-- Complete Database Setup - Run in order
-- Step 1: Create users table first (needed by all other tables)

CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('employee', 'supervisor', 'manager', 'accounting', 'vp', 'president', 'admin', 'super_admin')),
  department_id UUID,
  employee_id TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Step 2: Create departments table
CREATE TABLE IF NOT EXISTS departments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT,
  fiscal_year INTEGER DEFAULT EXTRACT(YEAR FROM CURRENT_DATE),
  monthly_budget DECIMAL(15,2) DEFAULT 0,
  remaining_budget DECIMAL(15,2) DEFAULT 0,
  petty_cash_balance DECIMAL(15,2) DEFAULT 0,
  head_id UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Step 3: Add department_id foreign key to users
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_department_id'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT fk_users_department_id FOREIGN KEY (department_id) REFERENCES departments(id);
  END IF;
END $$;

-- Step 4: Create categories table
CREATE TABLE IF NOT EXISTS categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  category_code TEXT NOT NULL,
  category_name TEXT NOT NULL,
  department_id UUID REFERENCES departments(id),
  budget_amount DECIMAL(15,2) DEFAULT 0,
  allocated_amount DECIMAL(15,2) DEFAULT 0,
  remaining_amount DECIMAL(15,2) DEFAULT 0,
  fiscal_year INTEGER DEFAULT EXTRACT(YEAR FROM CURRENT_DATE),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Step 5: Create cost_centers table
CREATE TABLE IF NOT EXISTS cost_centers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  department_id UUID REFERENCES departments(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Step 6: Create expense_requests table with co-approval columns
CREATE TABLE IF NOT EXISTS expense_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  request_code TEXT UNIQUE NOT NULL,
  employee_id UUID REFERENCES users(id),
  request_type TEXT NOT NULL,
  category_id UUID,
  item_name TEXT,
  department_id UUID REFERENCES departments(id),
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
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMP,
  rejected_by UUID REFERENCES users(id),
  rejected_at TIMESTAMP,
  released_by UUID REFERENCES users(id),
  released_at TIMESTAMP,
  returned_by UUID REFERENCES users(id),
  returned_at TIMESTAMP,
  on_hold_at TIMESTAMP,
  on_hold_by UUID REFERENCES users(id),
  co_approved_by UUID REFERENCES users(id),
  co_approved_at TIMESTAMP,
  co_approver_role TEXT,
  submitted_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT NOW()
);

SELECT 'All base tables created successfully!' as result;
