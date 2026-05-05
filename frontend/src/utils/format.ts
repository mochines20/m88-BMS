export const formatMoney = (value: number, currency: 'PHP' | 'USD' | 'IDR' = 'PHP') => {
  const locale = currency === 'IDR' ? 'id-ID' : 'en-PH';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number.isFinite(value) ? value : 0);
};

export const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const formatPercent = (value: number) => `${(Number.isFinite(value) ? value : 0).toFixed(2)}%`;

export const formatDateTime = (value?: string) => {
  if (!value) return 'No timestamp';
  return new Date(value).toLocaleString();
};

export const formatUptime = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
};

export const normalizeDisplayName = (name: string) => {
  const trimmed = String(name || '').trim();
  return trimmed.toLowerCase() === 'byahero' ? 'Byahero' : trimmed;
};

export const getStatusLabel = (status: string) => {
  switch (status) {
    case 'pending_supervisor': return 'Waiting for Supervisor Approval';
    case 'pending_accounting': return 'Waiting for Accounting Approval';
    case 'on_hold': return 'On Hold';
    case 'returned_for_revision': return 'Returned for Revision';
    case 'released': return 'Released';
    case 'approved': return 'Approved';
    case 'rejected': return 'Rejected';
    default: return status.replace(/_/g, ' ');
  }
};

export const getStatusColor = (status: string) => {
  switch (status) {
    case 'pending_supervisor': return 'border-[var(--role-secondary)]/30 bg-[var(--role-secondary)]/10 text-[var(--role-text)]';
    case 'pending_accounting': return 'border-[var(--role-primary)]/30 bg-[var(--role-primary)]/10 text-[var(--role-text)]';
    case 'approved':
    case 'released': return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700';
    case 'returned_for_revision': return 'border-orange-500/30 bg-orange-500/10 text-orange-700';
    case 'on_hold': return 'border-amber-500/30 bg-amber-500/10 text-amber-700';
    case 'rejected': return 'border-red-500/30 bg-red-500/10 text-red-700';
    default: return 'border-[var(--role-border)] bg-[var(--role-accent)] text-[var(--role-text)]';
  }
};

export const getRequesterName = (req: any) =>
  req?.requester_name || req?.users?.name || req?.user?.name || req?.employee_name || req?.requested_by || 'Unknown requester';

export const getRequesterDepartment = (req: any) =>
  req?.department_name || req?.departments?.name || req?.department?.name || 'Unknown department';

export const formatActionLabel = (action: string) => {
  const normalized = String(action || '').trim().toLowerCase();
  const LABELS: Record<string, string> = {
    co_approved: 'Co-Approved',
    liquidation_approved: 'Liquidation Approved',
    liquidation_rejected: 'Liquidation Rejected',
    submitted: 'Submitted',
    approved: 'Approved',
    rejected: 'Rejected',
    returned: 'Returned',
    returned_for_revision: 'Returned for Revision',
    released: 'Released',
    user_updated: 'User Updated',
    budget_category_created: 'Budget Category Created',
    budget_category_updated: 'Budget Category Updated',
    budget_category_deleted: 'Budget Category Deleted',
    force_approved: 'Force Approved (Override)',
  };
  return (
    LABELS[normalized] ||
    normalized
      .split('_')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  );
};
