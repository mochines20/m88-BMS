-- Optional cleanup migration
-- Purpose:
-- 1. Keep only one active fiscal year for departments
-- 2. Move users, tickets, allocations, direct expenses, and petty cash records
--    from older department-year rows into the target fiscal year
-- 3. Delete non-target fiscal year department rows after references are moved
--
-- Before running:
-- 1. Back up your Supabase database
-- 2. Make sure docs/schema.sql and docs/add-request-fiscal-year.sql were already run
--
-- Default behavior:
-- - Uses the latest fiscal year already present in departments
-- - If no department years exist, falls back to the current calendar year

BEGIN;

-- Normalize legacy aliases first so all mappings land on the same canonical names.
UPDATE departments
SET name = CASE LOWER(TRIM(name))
  WHEN 'm88it' THEN 'IT Department'
  WHEN 'm88purchasing' THEN 'Purchasing Department'
  WHEN 'm88planning' THEN 'Planning Department'
  WHEN 'm88logistics' THEN 'Logistics Department'
  WHEN 'm88hr' THEN 'HR Department'
  WHEN 'm88accounting' THEN 'Finance Department'
  WHEN 'accounting department' THEN 'Finance Department'
  WHEN 'm88admin' THEN 'Admin Department'
  ELSE name
END,
updated_at = NOW()
WHERE LOWER(TRIM(name)) IN (
  'm88it',
  'm88purchasing',
  'm88planning',
  'm88logistics',
  'm88hr',
  'm88accounting',
  'accounting department',
  'm88admin'
);

WITH target_year AS (
  SELECT COALESCE(MAX(fiscal_year), EXTRACT(YEAR FROM CURRENT_DATE)::INT) AS fiscal_year
  FROM departments
),
canonical_departments AS (
  SELECT unnest(ARRAY[
    'Admin Department',
    'Finance Department',
    'HR Department',
    'IT Department',
    'Logistics Department',
    'Planning Department',
    'Purchasing Department'
  ]) AS name
)
INSERT INTO departments (name, annual_budget, used_budget, petty_cash_balance, fiscal_year, updated_at)
SELECT
  cd.name,
  COALESCE((
    SELECT d.annual_budget
    FROM departments d
    WHERE LOWER(TRIM(d.name)) = LOWER(TRIM(cd.name))
    ORDER BY d.fiscal_year DESC, d.updated_at DESC NULLS LAST, d.created_at DESC NULLS LAST
    LIMIT 1
  ), 0) AS annual_budget,
  0,
  0,
  ty.fiscal_year,
  NOW()
FROM canonical_departments cd
CROSS JOIN target_year ty
WHERE NOT EXISTS (
  SELECT 1
  FROM departments d
  WHERE LOWER(TRIM(d.name)) = LOWER(TRIM(cd.name))
    AND d.fiscal_year = ty.fiscal_year
);

WITH target_year AS (
  SELECT COALESCE(MAX(fiscal_year), EXTRACT(YEAR FROM CURRENT_DATE)::INT) AS fiscal_year
  FROM departments
),
department_mapping AS (
  SELECT
    source.id AS source_department_id,
    target.id AS target_department_id,
    target.fiscal_year AS target_fiscal_year
  FROM departments source
  JOIN departments target
    ON LOWER(TRIM(target.name)) = LOWER(TRIM(source.name))
  CROSS JOIN target_year ty
  WHERE target.fiscal_year = ty.fiscal_year
    AND source.fiscal_year <> ty.fiscal_year
)
UPDATE users u
SET department_id = dm.target_department_id,
    updated_at = NOW()
FROM department_mapping dm
WHERE u.department_id = dm.source_department_id;

WITH target_year AS (
  SELECT COALESCE(MAX(fiscal_year), EXTRACT(YEAR FROM CURRENT_DATE)::INT) AS fiscal_year
  FROM departments
),
department_mapping AS (
  SELECT
    source.id AS source_department_id,
    target.id AS target_department_id,
    target.fiscal_year AS target_fiscal_year
  FROM departments source
  JOIN departments target
    ON LOWER(TRIM(target.name)) = LOWER(TRIM(source.name))
  CROSS JOIN target_year ty
  WHERE target.fiscal_year = ty.fiscal_year
    AND source.fiscal_year <> ty.fiscal_year
)
UPDATE expense_requests r
SET department_id = dm.target_department_id,
    fiscal_year = dm.target_fiscal_year,
    updated_at = NOW()
FROM department_mapping dm
WHERE r.department_id = dm.source_department_id;

WITH target_year AS (
  SELECT COALESCE(MAX(fiscal_year), EXTRACT(YEAR FROM CURRENT_DATE)::INT) AS fiscal_year
  FROM departments
),
department_mapping AS (
  SELECT
    source.id AS source_department_id,
    target.id AS target_department_id
  FROM departments source
  JOIN departments target
    ON LOWER(TRIM(target.name)) = LOWER(TRIM(source.name))
  CROSS JOIN target_year ty
  WHERE target.fiscal_year = ty.fiscal_year
    AND source.fiscal_year <> ty.fiscal_year
)
UPDATE request_allocations ra
SET department_id = dm.target_department_id,
    updated_at = NOW()
FROM department_mapping dm
WHERE ra.department_id = dm.source_department_id;

WITH target_year AS (
  SELECT COALESCE(MAX(fiscal_year), EXTRACT(YEAR FROM CURRENT_DATE)::INT) AS fiscal_year
  FROM departments
),
department_mapping AS (
  SELECT
    source.id AS source_department_id,
    target.id AS target_department_id
  FROM departments source
  JOIN departments target
    ON LOWER(TRIM(target.name)) = LOWER(TRIM(source.name))
  CROSS JOIN target_year ty
  WHERE target.fiscal_year = ty.fiscal_year
    AND source.fiscal_year <> ty.fiscal_year
)
UPDATE direct_expenses de
SET department_id = dm.target_department_id
FROM department_mapping dm
WHERE de.department_id = dm.source_department_id;

WITH target_year AS (
  SELECT COALESCE(MAX(fiscal_year), EXTRACT(YEAR FROM CURRENT_DATE)::INT) AS fiscal_year
  FROM departments
),
department_mapping AS (
  SELECT
    source.id AS source_department_id,
    target.id AS target_department_id
  FROM departments source
  JOIN departments target
    ON LOWER(TRIM(target.name)) = LOWER(TRIM(source.name))
  CROSS JOIN target_year ty
  WHERE target.fiscal_year = ty.fiscal_year
    AND source.fiscal_year <> ty.fiscal_year
)
UPDATE petty_cash_transactions pct
SET department_id = dm.target_department_id
FROM department_mapping dm
WHERE pct.department_id = dm.source_department_id;

WITH target_year AS (
  SELECT COALESCE(MAX(fiscal_year), EXTRACT(YEAR FROM CURRENT_DATE)::INT) AS fiscal_year
  FROM departments
)
DELETE FROM departments d
USING target_year ty
WHERE d.fiscal_year <> ty.fiscal_year;

COMMIT;

-- Quick verification query after running:
-- SELECT fiscal_year, COUNT(*) AS department_count FROM departments GROUP BY fiscal_year ORDER BY fiscal_year DESC;
