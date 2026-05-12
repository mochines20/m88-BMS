-- Step 2: Add foreign keys AFTER all tables exist
-- Run this AFTER create_tables_simple.sql succeeds

-- Add FK to users.department_id
ALTER TABLE users
  ADD CONSTRAINT IF NOT EXISTS fk_users_department_id 
  FOREIGN KEY (department_id) REFERENCES departments(id);

-- Add FKs to expense_requests
ALTER TABLE expense_requests
  ADD CONSTRAINT IF NOT EXISTS fk_expense_requests_employee_id 
  FOREIGN KEY (employee_id) REFERENCES users(id),
  
  ADD CONSTRAINT IF NOT EXISTS fk_expense_requests_department_id 
  FOREIGN KEY (department_id) REFERENCES departments(id),
  
  ADD CONSTRAINT IF NOT EXISTS fk_expense_requests_approved_by 
  FOREIGN KEY (approved_by) REFERENCES users(id),
  
  ADD CONSTRAINT IF NOT EXISTS fk_expense_requests_rejected_by 
  FOREIGN KEY (rejected_by) REFERENCES users(id),
  
  ADD CONSTRAINT IF NOT EXISTS fk_expense_requests_released_by 
  FOREIGN KEY (released_by) REFERENCES users(id),
  
  ADD CONSTRAINT IF NOT EXISTS fk_expense_requests_returned_by 
  FOREIGN KEY (returned_by) REFERENCES users(id),
  
  ADD CONSTRAINT IF NOT EXISTS fk_expense_requests_on_hold_by 
  FOREIGN KEY (on_hold_by) REFERENCES users(id),
  
  ADD CONSTRAINT IF NOT EXISTS fk_expense_requests_co_approved_by 
  FOREIGN KEY (co_approved_by) REFERENCES users(id);

SELECT 'All foreign keys added successfully!' as step2;
