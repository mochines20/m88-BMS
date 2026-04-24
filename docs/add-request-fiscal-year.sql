ALTER TABLE expense_requests
ADD COLUMN IF NOT EXISTS fiscal_year INT;

UPDATE expense_requests r
SET fiscal_year = d.fiscal_year
FROM departments d
WHERE d.id = r.department_id
  AND (r.fiscal_year IS NULL OR r.fiscal_year IS DISTINCT FROM d.fiscal_year);

CREATE INDEX IF NOT EXISTS idx_expense_requests_fiscal_year
ON expense_requests(fiscal_year);

WITH requested_year AS (
  SELECT EXTRACT(YEAR FROM CURRENT_DATE)::INT AS fiscal_year
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
  0 AS used_budget,
  0 AS petty_cash_balance,
  ry.fiscal_year,
  NOW()
FROM canonical_departments cd
CROSS JOIN requested_year ry
WHERE NOT EXISTS (
  SELECT 1
  FROM departments d
  WHERE LOWER(TRIM(d.name)) = LOWER(TRIM(cd.name))
    AND d.fiscal_year = ry.fiscal_year
);
