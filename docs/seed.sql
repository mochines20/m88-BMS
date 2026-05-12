-- Sample data for Madison88 BMS
-- Run this after the schema is created
-- Department codes shown in the UI:
-- IT Department -> m88IT
-- Purchasing Department -> m88Purchasing
-- Planning Department -> m88Planning
-- Logistics Department -> m88logistics
-- HR Department -> m88HR
-- Finance Department -> m88accounting
-- Admin Department -> m88ADMIN

-- Rename old legacy department names to cleaner display names
UPDATE departments
SET name = CASE name
  WHEN 'm88IT' THEN 'IT Department'
  WHEN 'm88Purchasing' THEN 'Purchasing Department'
  WHEN 'm88Planning' THEN 'Planning Department'
  WHEN 'm88logistics' THEN 'Logistics Department'
  WHEN 'm88HR' THEN 'HR Department'
  WHEN 'm88accounting' THEN 'Finance Department'
  WHEN 'm88ADMIN' THEN 'Admin Department'
  WHEN 'Accounting Department' THEN 'Finance Department'
  ELSE name
END,
updated_at = NOW()
WHERE name IN (
  'm88IT',
  'm88Purchasing',
  'm88Planning',
  'm88logistics',
  'm88HR',
  'm88accounting',
  'm88ADMIN',
  'Accounting Department'
);

-- Insert departments if they do not already exist
WITH active_year AS (
  SELECT EXTRACT(YEAR FROM CURRENT_DATE)::INT AS fiscal_year
)
INSERT INTO departments (name, annual_budget, fiscal_year)
SELECT name, annual_budget, fiscal_year
FROM (
  SELECT department_rows.name, department_rows.annual_budget, active_year.fiscal_year
  FROM (VALUES
    ('IT Department', 500000.00),
    ('Purchasing Department', 400000.00),
    ('Planning Department', 350000.00),
    ('Logistics Department', 450000.00),
    ('HR Department', 200000.00),
    ('Finance Department', 300000.00),
    ('Admin Department', 250000.00)
  ) AS department_rows(name, annual_budget)
  CROSS JOIN active_year
) AS vals(name, annual_budget, fiscal_year)
WHERE NOT EXISTS (
  SELECT 1
  FROM departments d
  WHERE LOWER(TRIM(d.name)) = LOWER(TRIM(vals.name))
    AND d.fiscal_year = vals.fiscal_year
);

-- Insert users if they do not already exist
-- Generated with: bcrypt.hashSync('password123', 10)
WITH user_rows AS (
  SELECT * FROM (VALUES
    ('John Employee', 'john.employee@madison88.com', '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu', 'employee', 'IT Department'),
    ('Jane Supervisor', 'jane.supervisor@madison88.com', '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu', 'supervisor', 'IT Department'),
    ('Bob Accounting', 'bob.accounting@madison88.com', '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu', 'accounting', 'Finance Department'),
    ('Alice Admin', 'alice.admin@madison88.com', '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu', 'admin', 'Admin Department'),
    ('Management Executive', 'management@madison88.com', '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu', 'management', NULL),
    ('Sarah Super Admin', 'sarah.superadmin@madison88.com', '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu', 'super_admin', NULL)
  ) AS v(name, email, password_hash, role, department_name)
)
INSERT INTO users (name, email, password_hash, role, department_id)
SELECT u.name, u.email, u.password_hash, u.role, d.id
FROM user_rows u
LEFT JOIN departments d ON d.name = u.department_name
WHERE NOT EXISTS (
  SELECT 1 FROM users x WHERE x.email = u.email
);

-- Update sample user passwords and roles if the users already exist
WITH user_rows AS (
  SELECT * FROM (VALUES
    ('John Employee', 'john.employee@madison88.com', '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu', 'employee'),
    ('Jane Supervisor', 'jane.supervisor@madison88.com', '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu', 'supervisor'),
    ('Bob Accounting', 'bob.accounting@madison88.com', '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu', 'accounting'),
    ('Alice Admin', 'alice.admin@madison88.com', '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu', 'admin'),
    ('Sarah Super Admin', 'sarah.superadmin@madison88.com', '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu', 'super_admin')
  ) AS v(name, email, password_hash, role)
)
UPDATE users
SET name = u.name,
    password_hash = u.password_hash,
    role = u.role,
    updated_at = NOW()
FROM user_rows u
WHERE users.email = u.email
  AND (
    users.name IS DISTINCT FROM u.name
    OR users.password_hash IS DISTINCT FROM u.password_hash
    OR users.role IS DISTINCT FROM u.role
  );

-- Move existing users into the renamed departments if they already exist
UPDATE users
SET department_id = d.id,
    updated_at = NOW()
FROM departments d
WHERE users.email = 'john.employee@madison88.com'
  AND d.name = 'IT Department'
  AND users.department_id IS DISTINCT FROM d.id;

UPDATE users
SET department_id = d.id,
    updated_at = NOW()
FROM departments d
WHERE users.email = 'jane.supervisor@madison88.com'
  AND d.name = 'IT Department'
  AND users.department_id IS DISTINCT FROM d.id;

UPDATE users
SET department_id = d.id,
    updated_at = NOW()
FROM departments d
WHERE users.email = 'bob.accounting@madison88.com'
  AND d.name = 'Finance Department'
  AND users.department_id IS DISTINCT FROM d.id;

UPDATE users
SET department_id = d.id,
    updated_at = NOW()
FROM departments d
WHERE users.email = 'alice.admin@madison88.com'
  AND d.name = 'Admin Department'
  AND users.department_id IS DISTINCT FROM d.id;

UPDATE users
SET department_id = NULL,
    updated_at = NOW()
WHERE users.email = 'sarah.superadmin@madison88.com'
  AND users.department_id IS NOT NULL;

-- Insert sample budget categories for each department
WITH active_year AS (
  SELECT EXTRACT(YEAR FROM CURRENT_DATE)::INT AS fiscal_year
)
INSERT INTO budget_categories (department_id, fiscal_year, category_code, category_name, budget_amount)
SELECT d.id, active_year.fiscal_year, bc.category_code, bc.category_name, bc.budget_amount
FROM departments d
CROSS JOIN active_year
CROSS JOIN (VALUES
  ('IT001', 'IT Equipment', 100000.00),
  ('IT002', 'Software Licenses', 50000.00),
  ('IT003', 'IT Services', 30000.00),
  ('PUR001', 'Office Supplies', 50000.00),
  ('PUR002', 'Equipment', 150000.00),
  ('PUR003', 'Services', 50000.00),
  ('PLAN001', 'Training', 50000.00),
  ('PLAN002', 'Events', 100000.00),
  ('LOG001', 'Transportation', 200000.00),
  ('LOG002', 'Logistics Services', 100000.00),
  ('HR001', 'Employee Benefits', 100000.00),
  ('HR002', 'Training & Development', 50000.00),
  ('FIN001', 'Accounting Software', 50000.00),
  ('FIN002', 'Audit Services', 100000.00),
  ('ADM001', 'Office Maintenance', 100000.00),
  ('ADM002', 'Administrative Supplies', 50000.00)
) AS bc(category_code, category_name, budget_amount)
WHERE NOT EXISTS (
  SELECT 1 FROM budget_categories b
  WHERE b.department_id = d.id
    AND b.fiscal_year = active_year.fiscal_year
    AND b.category_code = bc.category_code
);
