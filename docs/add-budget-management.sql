-- Budget Management System Schema Additions
-- Adds support for Categories, Cost Centers, Cash Advances, and Liquidations

-- 1. Budget Categories Table
CREATE TABLE IF NOT EXISTS budget_categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  fiscal_year INT NOT NULL,
  category_code TEXT NOT NULL,
  category_name TEXT NOT NULL,
  budget_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  used_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  committed_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  remaining_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(department_id, fiscal_year, category_code)
);

-- 2. Cost Centers Table
CREATE TABLE IF NOT EXISTS cost_centers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  cost_center_code TEXT NOT NULL,
  cost_center_name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(department_id, cost_center_code)
);

-- 3. Cash Advances Table (tracks issued cash advances)
CREATE TABLE IF NOT EXISTS cash_advances (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id UUID REFERENCES expense_requests(id) ON DELETE SET NULL,
  employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  advance_code TEXT UNIQUE NOT NULL,
  amount_issued DECIMAL(15,2) NOT NULL,
  amount_liquidated DECIMAL(15,2) DEFAULT 0,
  balance DECIMAL(15,2) NOT NULL,
  expected_liquidation_date DATE,
  liquidation_due_at TIMESTAMP,
  purpose TEXT,
  status TEXT CHECK (status IN ('outstanding', 'partially_liquidated', 'fully_liquidated', 'overdue')) DEFAULT 'outstanding',
  issued_at TIMESTAMP DEFAULT NOW(),
  issued_by UUID REFERENCES users(id),
  fully_liquidated_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 4. Liquidation Items Table (expense lines for cash advance liquidation)
CREATE TABLE IF NOT EXISTS liquidation_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cash_advance_id UUID NOT NULL REFERENCES cash_advances(id) ON DELETE CASCADE,
  liquidation_id UUID REFERENCES expense_requests(id) ON DELETE SET NULL,
  expense_date DATE NOT NULL,
  category_id UUID REFERENCES budget_categories(id),
  description TEXT,
  amount DECIMAL(15,2) NOT NULL,
  receipt_attached BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 5. Update expense_requests table to support new request types
DO $$
BEGIN
  -- Add request_type column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'expense_requests' AND column_name = 'request_type'
  ) THEN
    ALTER TABLE expense_requests ADD COLUMN request_type 
      TEXT CHECK (request_type IN ('reimbursement', 'cash_advance', 'liquidation')) DEFAULT 'reimbursement';
  END IF;

  -- Add cost_center_id column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'expense_requests' AND column_name = 'cost_center_id'
  ) THEN
    ALTER TABLE expense_requests ADD COLUMN cost_center_id UUID REFERENCES cost_centers(id);
  END IF;

  -- Add category_id column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'expense_requests' AND column_name = 'category_id'
  ) THEN
    ALTER TABLE expense_requests ADD COLUMN category_id UUID REFERENCES budget_categories(id);
  END IF;

  -- Add expense_date column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'expense_requests' AND column_name = 'expense_date'
  ) THEN
    ALTER TABLE expense_requests ADD COLUMN expense_date DATE;
  END IF;

  -- Add project column if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'expense_requests' AND column_name = 'project'
  ) THEN
    ALTER TABLE expense_requests ADD COLUMN project TEXT;
  END IF;

  -- Add expected_liquidation_date for cash advances
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'expense_requests' AND column_name = 'expected_liquidation_date'
  ) THEN
    ALTER TABLE expense_requests ADD COLUMN expected_liquidation_date DATE;
  END IF;

  -- Add on_hold_at timestamp for tracking when requests are placed on hold
  ALTER TABLE expense_requests ADD COLUMN IF NOT EXISTS on_hold_at TIMESTAMP;

  -- Add original_advance_id for liquidations
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'expense_requests' AND column_name = 'original_advance_id'
  ) THEN
    ALTER TABLE expense_requests ADD COLUMN original_advance_id UUID REFERENCES cash_advances(id);
  END IF;
END $$;

-- 6. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_budget_categories_dept_year ON budget_categories(department_id, fiscal_year);
CREATE INDEX IF NOT EXISTS idx_cash_advances_employee ON cash_advances(employee_id);
CREATE INDEX IF NOT EXISTS idx_cash_advances_status ON cash_advances(status);
CREATE INDEX IF NOT EXISTS idx_cash_advances_due ON cash_advances(liquidation_due_at);
CREATE INDEX IF NOT EXISTS idx_liquidation_items_advance ON liquidation_items(cash_advance_id);

-- 7. Insert default budget categories for existing departments
INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount)
SELECT 
  d.id as department_id,
  d.fiscal_year,
  'PERSONNEL' as category_code,
  'Personnel Cost' as category_name,
  d.annual_budget * 0.5 as budget_amount
FROM departments d
WHERE NOT EXISTS (
  SELECT 1 FROM budget_categories bc 
  WHERE bc.department_id = d.id AND bc.fiscal_year = d.fiscal_year
)
ON CONFLICT DO NOTHING;

-- 8. Insert sample cost centers for existing departments
INSERT INTO cost_centers (department_id, cost_center_code, cost_center_name, description)
SELECT 
  d.id as department_id,
  UPPER(REPLACE(REPLACE(d.name, ' ', '_'), '-', '_')) || '_001' as cost_center_code,
  d.name || ' - Main' as cost_center_name,
  'Primary cost center for ' || d.name as description
FROM departments d
WHERE NOT EXISTS (
  SELECT 1 FROM cost_centers cc 
  WHERE cc.department_id = d.id
)
ON CONFLICT DO NOTHING;

-- 9. Create function to update cash advance balance
CREATE OR REPLACE FUNCTION update_cash_advance_balance()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE cash_advances
  SET 
    amount_liquidated = (
      SELECT COALESCE(SUM(amount), 0) 
      FROM liquidation_items 
      WHERE cash_advance_id = NEW.cash_advance_id
    ),
    balance = amount_issued - (
      SELECT COALESCE(SUM(amount), 0) 
      FROM liquidation_items 
      WHERE cash_advance_id = NEW.cash_advance_id
    ),
    status = CASE 
      WHEN amount_issued - (
        SELECT COALESCE(SUM(amount), 0) 
        FROM liquidation_items 
        WHERE cash_advance_id = NEW.cash_advance_id
      ) <= 0 THEN 'fully_liquidated'
      WHEN (
        SELECT COALESCE(SUM(amount), 0) 
        FROM liquidation_items 
        WHERE cash_advance_id = NEW.cash_advance_id
      ) > 0 THEN 'partially_liquidated'
      ELSE 'outstanding'
    END,
    fully_liquidated_at = CASE 
      WHEN amount_issued - (
        SELECT COALESCE(SUM(amount), 0) 
        FROM liquidation_items 
        WHERE cash_advance_id = NEW.cash_advance_id
      ) <= 0 THEN NOW()
      ELSE NULL
    END,
    updated_at = NOW()
  WHERE id = NEW.cash_advance_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS trg_update_cash_advance_balance ON liquidation_items;

-- Create trigger
CREATE TRIGGER trg_update_cash_advance_balance
AFTER INSERT OR UPDATE OR DELETE ON liquidation_items
FOR EACH ROW
EXECUTE FUNCTION update_cash_advance_balance();

-- 10. Create function to check overdue cash advances
CREATE OR REPLACE FUNCTION check_overdue_cash_advances()
RETURNS void AS $$
BEGIN
  UPDATE cash_advances
  SET status = 'overdue',
      updated_at = NOW()
  WHERE status IN ('outstanding', 'partially_liquidated')
    AND liquidation_due_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- 11. Add RLS policies
ALTER TABLE budget_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE liquidation_items ENABLE ROW LEVEL SECURITY;

-- Policies for budget_categories
CREATE POLICY "Allow all read budget_categories" ON budget_categories
  FOR SELECT USING (true);
CREATE POLICY "Allow finance/admin write budget_categories" ON budget_categories
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role IN ('accounting', 'admin', 'super_admin')
    )
  );

-- Policies for cost_centers
CREATE POLICY "Allow all read cost_centers" ON cost_centers
  FOR SELECT USING (true);
CREATE POLICY "Allow finance/admin write cost_centers" ON cost_centers
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role IN ('accounting', 'admin', 'super_admin')
    )
  );

-- Policies for cash_advances
CREATE POLICY "Allow own cash advances" ON cash_advances
  FOR SELECT USING (employee_id = auth.uid());
CREATE POLICY "Allow finance view all cash advances" ON cash_advances
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role IN ('accounting', 'admin', 'super_admin', 'supervisor')
    )
  );

-- Policies for liquidation_items
CREATE POLICY "Allow own liquidation items" ON liquidation_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM cash_advances 
      WHERE cash_advances.id = liquidation_items.cash_advance_id
      AND cash_advances.employee_id = auth.uid()
    )
  );
CREATE POLICY "Allow finance view all liquidation items" ON liquidation_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role IN ('accounting', 'admin', 'super_admin', 'supervisor')
    )
  );

COMMENT ON TABLE budget_categories IS 'Budget allocation by category per department and fiscal year';
COMMENT ON TABLE cost_centers IS 'Cost centers within departments for expense tracking';
COMMENT ON TABLE cash_advances IS 'Cash advances issued to employees';
COMMENT ON TABLE liquidation_items IS 'Individual expense items for cash advance liquidation';
