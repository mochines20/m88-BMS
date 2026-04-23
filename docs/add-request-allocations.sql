CREATE TABLE IF NOT EXISTS request_allocations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id UUID REFERENCES expense_requests(id) ON DELETE CASCADE,
  department_id UUID REFERENCES departments(id),
  amount DECIMAL(15,2) NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS allocation_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id UUID REFERENCES expense_requests(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_request_allocations_request_id
ON request_allocations(request_id);

CREATE INDEX IF NOT EXISTS idx_request_allocations_department_id
ON request_allocations(department_id);

CREATE INDEX IF NOT EXISTS idx_allocation_logs_request_id
ON allocation_logs(request_id);
