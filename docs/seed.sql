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
INSERT INTO departments (name, annual_budget, fiscal_year)
SELECT name, annual_budget, fiscal_year
FROM (VALUES
  ('IT Department', 500000.00, 2024),
  ('Purchasing Department', 400000.00, 2024),
  ('Planning Department', 350000.00, 2024),
  ('Logistics Department', 450000.00, 2024),
  ('HR Department', 200000.00, 2024),
  ('Finance Department', 300000.00, 2024),
  ('Admin Department', 250000.00, 2024)
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
    ('Alice Admin', 'alice.admin@madison88.com', '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu', 'admin', 'Admin Department')
  ) AS v(name, email, password_hash, role, department_name)
)
INSERT INTO users (name, email, password_hash, role, department_id)
SELECT u.name, u.email, u.password_hash, u.role, d.id
FROM user_rows u
JOIN departments d ON d.name = u.department_name
WHERE NOT EXISTS (
  SELECT 1 FROM users x WHERE x.email = u.email
);

-- Update sample user passwords and roles if the users already exist
WITH user_rows AS (
  SELECT * FROM (VALUES
    ('John Employee', 'john.employee@madison88.com', '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu', 'employee'),
    ('Jane Supervisor', 'jane.supervisor@madison88.com', '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu', 'supervisor'),
    ('Bob Accounting', 'bob.accounting@madison88.com', '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu', 'accounting'),
    ('Alice Admin', 'alice.admin@madison88.com', '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu', 'admin')
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
