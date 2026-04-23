-- Merge duplicate departments by (name, fiscal_year) and keep the oldest row as canonical.
-- Run this once before adding the unique index below.

-- Normalize legacy and alias department names first so they collapse into the same canonical rows.
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

WITH ranked_departments AS (
  SELECT
    id,
    name,
    fiscal_year,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY LOWER(TRIM(name)), fiscal_year
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS row_num,
    FIRST_VALUE(id) OVER (
      PARTITION BY LOWER(TRIM(name)), fiscal_year
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS canonical_id
  FROM departments
),
duplicate_departments AS (
  SELECT id, canonical_id
  FROM ranked_departments
  WHERE row_num > 1
)
UPDATE users u
SET department_id = d.canonical_id
FROM duplicate_departments d
WHERE u.department_id = d.id;

WITH ranked_departments AS (
  SELECT
    id,
    name,
    fiscal_year,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY LOWER(TRIM(name)), fiscal_year
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS row_num,
    FIRST_VALUE(id) OVER (
      PARTITION BY LOWER(TRIM(name)), fiscal_year
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS canonical_id
  FROM departments
),
duplicate_departments AS (
  SELECT id, canonical_id
  FROM ranked_departments
  WHERE row_num > 1
)
UPDATE expense_requests r
SET department_id = d.canonical_id
FROM duplicate_departments d
WHERE r.department_id = d.id;

WITH ranked_departments AS (
  SELECT
    id,
    name,
    fiscal_year,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY LOWER(TRIM(name)), fiscal_year
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS row_num,
    FIRST_VALUE(id) OVER (
      PARTITION BY LOWER(TRIM(name)), fiscal_year
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS canonical_id
  FROM departments
),
duplicate_departments AS (
  SELECT id, canonical_id
  FROM ranked_departments
  WHERE row_num > 1
)
UPDATE direct_expenses e
SET department_id = d.canonical_id
FROM duplicate_departments d
WHERE e.department_id = d.id;

WITH ranked_departments AS (
  SELECT
    id,
    name,
    fiscal_year,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY LOWER(TRIM(name)), fiscal_year
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS row_num,
    FIRST_VALUE(id) OVER (
      PARTITION BY LOWER(TRIM(name)), fiscal_year
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS canonical_id
  FROM departments
),
duplicate_departments AS (
  SELECT id, canonical_id
  FROM ranked_departments
  WHERE row_num > 1
)
UPDATE petty_cash_transactions p
SET department_id = d.canonical_id
FROM duplicate_departments d
WHERE p.department_id = d.id;

WITH ranked_departments AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY LOWER(TRIM(name)), fiscal_year
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS row_num
  FROM departments
)
DELETE FROM departments d
USING ranked_departments r
WHERE d.id = r.id
  AND r.row_num > 1;

CREATE UNIQUE INDEX IF NOT EXISTS departments_name_fiscal_year_unique_idx
ON departments (LOWER(TRIM(name)), fiscal_year);
