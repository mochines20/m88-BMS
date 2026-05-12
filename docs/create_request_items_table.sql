-- Create request_items table to support multiple items per reimbursement request
CREATE TABLE IF NOT EXISTS request_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES expense_requests(id) ON DELETE CASCADE,
  item_name VARCHAR(255) NOT NULL,
  category_id UUID REFERENCES budget_categories(id),
  amount DECIMAL(15,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_request_items_request_id ON request_items(request_id);

COMMENT ON TABLE request_items IS 'Stores individual line items for expense requests (reimbursement with multiple items)';
