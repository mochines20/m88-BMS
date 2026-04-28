ALTER TABLE expense_requests
  DROP CONSTRAINT IF EXISTS expense_requests_status_check;

ALTER TABLE expense_requests
  ADD CONSTRAINT expense_requests_status_check
  CHECK (
    status IN (
      'draft',
      'pending_supervisor',
      'pending_accounting',
      'approved',
      'rejected',
      'returned_for_revision',
      'released'
    )
  );
