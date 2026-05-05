ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('employee', 'manager', 'supervisor', 'accounting', 'management', 'admin', 'super_admin'));
