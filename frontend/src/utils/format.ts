export const formatMoney = (value: number, currency: 'PHP' | 'USD' | 'IDR' = 'PHP') => {
  const locale = currency === 'IDR' ? 'id-ID' : 'en-PH';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number.isFinite(value) ? value : 0);
};

export const getErrorMessage = (err: any, fallback = 'An unexpected error occurred'): string => {
  const raw = err?.response?.data?.error ?? err?.response?.data?.message ?? err?.message ?? fallback;
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object') return String(raw.message || raw.details || raw.hint || fallback);
  return fallback;
};

export const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const formatPercent = (value: number) => `${(Number.isFinite(value) ? value : 0).toFixed(2)}%`;

export const formatDateTime = (value?: string) => {
  if (!value) return 'No timestamp';
  
  let date: Date;
  try {
    // If it's a string from the database, it's likely UTC. 
    // Ensure it's treated as UTC if it looks like an ISO string but lacks a timezone indicator.
    let dateString = value;
    if (typeof value === 'string' && value.includes('-') && !value.includes('Z') && !value.includes('+')) {
      dateString = value.replace(' ', 'T') + 'Z';
    }
    date = new Date(dateString);
    
    // Check if valid
    if (isNaN(date.getTime())) {
      date = new Date(value);
    }
  } catch (e) {
    date = new Date(value);
  }

  // Use Philippines timezone (UTC+8)
  return date.toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
};

export const formatRelativeTime = (value?: string) => {
  if (!value) return '';
  
  const date = new Date(value);
  const now = new Date();
  
  // Calculate difference in milliseconds
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffSeconds < 60) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  
  // For older dates, show actual date
  return date.toLocaleDateString('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric'
  });
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
    case 'pending_supervisor': return 'For Supervisor Review';
    case 'pending_accounting': return 'For Accounting Review';
    case 'on_hold': return 'On Hold';
    case 'returned_for_revision': return 'Returned for Correction';
    case 'released': return 'Disbursed';
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
