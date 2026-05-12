-- Fix: Remove any restrictive RLS policies on budget_categories that block accounting role
-- Run this in Supabase SQL Editor

-- Step 1: Drop ALL existing policies on budget_categories to start clean
DROP POLICY IF EXISTS "Allow all read budget_categories" ON budget_categories;
DROP POLICY IF EXISTS "Allow finance/admin write budget_categories" ON budget_categories;
DROP POLICY IF EXISTS "Users can only view budget categories for their own department" ON budget_categories;
DROP POLICY IF EXISTS "budget_categories_select_policy" ON budget_categories;
DROP POLICY IF EXISTS "budget_categories_all_policy" ON budget_categories;

-- Drop any other policies that may exist (check all by name pattern)
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname
        FROM pg_policies
        WHERE tablename = 'budget_categories'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON budget_categories', pol.policyname);
    END LOOP;
END $$;

-- Step 2: Recreate correct policies

-- Everyone can read budget categories (needed for request creation, category display, etc.)
CREATE POLICY "budget_categories_read_all"
  ON budget_categories
  FOR SELECT
  USING (true);

-- Only accounting/admin/super_admin can insert/update/delete
CREATE POLICY "budget_categories_write_finance"
  ON budget_categories
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('accounting', 'admin', 'super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('accounting', 'admin', 'super_admin')
    )
  );
