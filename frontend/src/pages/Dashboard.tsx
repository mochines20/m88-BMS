import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import toast from 'react-hot-toast';

const formatMoney = (value: number) =>
  new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number.isFinite(value) ? value : 0);

const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getStatusLabel = (status: string) => {
  switch (status) {
    case 'pending_supervisor':
      return 'Waiting for Supervisor Approval';
    case 'pending_accounting':
      return 'Waiting for Accounting Approval';
    case 'released':
      return 'Released';
    case 'approved':
      return 'Approved';
    case 'rejected':
      return 'Rejected';
    default:
      return status.replace(/_/g, ' ');
  }
};

const getStatusTone = (status: string) => {
  switch (status) {
    case 'pending_supervisor':
      return 'border-[var(--role-secondary)]/30 bg-[var(--role-secondary)]/10 text-[var(--role-secondary)]';
    case 'pending_accounting':
      return 'border-[var(--role-primary)]/30 bg-[var(--role-primary)]/10 text-[var(--role-primary)]';
    case 'released':
    case 'approved':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600';
    case 'rejected':
      return 'border-red-500/30 bg-red-500/10 text-red-600';
    default:
      return 'border-[var(--role-border)] bg-[var(--role-accent)] text-[var(--role-text)]/70';
  }
};

const getRequesterName = (request: any) =>
  request.requester_name || request.users?.name || request.user?.name || request.employee_name || request.requested_by || 'Unknown requester';

const getRequesterDepartment = (request: any) =>
  request.department_name || request.departments?.name || request.department?.name || 'Unknown department';

const getRoleHeadline = (role?: string) => {
  switch (role) {
    case 'employee':
      return 'Track your requests and stay updated on their progress.';
    case 'supervisor':
      return 'Oversee your department\'s requests and manage approvals.';
    case 'accounting':
      return 'Monitor financial health and process final fund releases.';
    case 'admin':
    case 'super_admin':
      return 'Manage system-wide settings, users, and department budgets.';
    default:
      return 'Manage your budget requests and approvals in one place.';
  }
};

const getRoleFocus = (role?: string) => {
  switch (role) {
    case 'employee':
      return 'My Request Activity';
    case 'supervisor':
      return 'Department Approval Queue';
    case 'accounting':
      return 'Financial Release Queue';
    case 'admin':
    case 'super_admin':
      return 'System Activity Overview';
    default:
      return 'Recent Activity';
  }
};

const normalizeDisplayName = (name: string) => {
  const trimmedName = String(name || '').trim();
  return trimmedName.toLowerCase() === 'byahero' ? 'Byahero' : trimmedName;
};

const condenseLogs = (logs: any[]) => {
  return logs.reduce((acc: any[], log: any) => {
    const previous = acc[acc.length - 1];
    const sameGroup = previous &&
      previous.action === log.action &&
      previous.stage === log.stage &&
      previous.actor_name === log.actor_name &&
      previous.actor_role === log.actor_role &&
      previous.note === log.note;

    if (sameGroup) {
      previous.count += 1;
      previous.latestTimestamp = log.timestamp;
      return acc;
    }

    acc.push({ ...log, count: 1, latestTimestamp: log.timestamp });
    return acc;
  }, []);
};

const Dashboard = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [requests, setRequests] = useState<any[]>([]);
  const [timeline, setTimeline] = useState<any[]>([]);
  const [systemHealth, setSystemHealth] = useState<any>(null);
  const [flowPage, setFlowPage] = useState(1);
  const [archiveView, setArchiveView] = useState<'active' | 'archived' | 'all'>('active');

  const pageSize = 3;

  const fetchTimeline = async (id: string) => {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      const res = await api.get(`/api/requests/${id}/timeline`, { headers: { Authorization: `Bearer ${token}` } });
      setTimeline(res.data);
    } catch {
      setTimeline([]);
    }
  };

  const fetchSystemHealth = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      const res = await api.get('/api/system/health', { headers: { Authorization: `Bearer ${token}` } });
      setSystemHealth(res.data);
    } catch {
      setSystemHealth(null);
    }
  };

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    const refreshDashboard = async () => {
      try {
        const [userResponse, requestsResponse] = await Promise.all([
          api.get('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } }),
          api.get('/api/requests', { headers: { Authorization: `Bearer ${token}` } })
        ]);
        setUser(userResponse.data);
        setRequests(requestsResponse.data);

        if (userResponse.data.role === 'super_admin') {
          void fetchSystemHealth();
        }

        if (requestsResponse.data.length > 0) {
          await fetchTimeline(requestsResponse.data[0].id);
        }
      } catch {
        localStorage.removeItem('token');
      }
    };

    refreshDashboard();
    const intervalId = window.setInterval(refreshDashboard, 5000);
    return () => window.clearInterval(intervalId);
  }, []);

  const stats = useMemo(() => {
    const total = requests.length;
    const pendingSupervisor = requests.filter((r: any) => r.status === 'pending_supervisor').length;
    const pendingAccounting = requests.filter((r: any) => r.status === 'pending_accounting').length;
    const released = requests.filter((r: any) => r.status === 'released' || r.status === 'approved').length;
    const rejected = requests.filter((r: any) => r.status === 'rejected').length;
    const totalAmount = requests.reduce((sum: number, request: any) => sum + toNumber(request.amount), 0);
    const pendingAmount = requests
      .filter((r: any) => ['pending_supervisor', 'pending_accounting', 'returned_for_revision'].includes(r.status))
      .reduce((sum: number, request: any) => sum + toNumber(request.amount), 0);
    const releasedAmount = requests
      .filter((r: any) => r.status === 'released' || r.status === 'approved')
      .reduce((sum: number, request: any) => sum + toNumber(request.amount), 0);
    const rejectedAmount = requests
      .filter((r: any) => r.status === 'rejected')
      .reduce((sum: number, request: any) => sum + toNumber(request.amount), 0);

    return {
      total,
      pendingSupervisor,
      pendingAccounting,
      released,
      rejected,
      totalAmount,
      pendingAmount,
      releasedAmount,
      rejectedAmount
    };
  }, [requests]);

  const recentRequests = useMemo(
    () =>
      [...requests]
        .filter((request: any) => {
          if (archiveView === 'all') return true;
          if (archiveView === 'archived') return Boolean(request.archived);
          return !request.archived;
        })
        .sort((a: any, b: any) => new Date(b.submitted_at || b.updated_at).getTime() - new Date(a.submitted_at || a.updated_at).getTime()),
    [archiveView, requests]
  );

  const totalFlowPages = Math.max(1, Math.ceil(recentRequests.length / pageSize));

  const paginatedRequests = useMemo(() => {
    const startIndex = (flowPage - 1) * pageSize;
    return recentRequests.slice(startIndex, startIndex + pageSize);
  }, [flowPage, recentRequests]);

  useEffect(() => {
    setFlowPage((currentPage) => Math.min(currentPage, totalFlowPages));
  }, [totalFlowPages]);

  const condensedTimeline = useMemo(() => condenseLogs(timeline), [timeline]);

  const toggleArchive = async (requestId: string, archived: boolean) => {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      await api.patch(
        `/api/requests/${requestId}/archive`,
        { archived },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setRequests((current) => current.map((request: any) => (
        request.id === requestId ? { ...request, archived } : request
      )));
      toast.success(`Request ${archived ? 'archived' : 'unarchived'} successfully.`);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Archive update failed');
    }
  };

  if (!user) return <div className="text-[var(--role-text)]">Loading...</div>;

  return (
    <div className="text-[var(--role-text)]">
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">
          Welcome back, {normalizeDisplayName(user.name)}. {getRoleHeadline(user.role)}
        </p>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {user.role === 'employee' ? (
          <>
            <div className="stat-card group relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-[var(--role-primary)]/20 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              <p className="stat-label">My Requests</p>
              <h3 className="stat-value">{stats.total}</h3>
            </div>
            <div className="stat-card group relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-[var(--role-secondary)]/20 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              <p className="stat-label">In Review</p>
              <h3 className="stat-value" style={{ color: 'var(--role-secondary)' }}>{stats.pendingSupervisor + stats.pendingAccounting}</h3>
            </div>
            <div className="stat-card group relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-[var(--role-text)]/20 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              <p className="stat-label">Approved / Released</p>
              <h3 className="stat-value" style={{ color: 'var(--role-text)' }}>{stats.released}</h3>
            </div>
            <div className="stat-card group relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/20 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              <p className="stat-label">Total Amount</p>
              <h3 className="stat-value" style={{ color: 'var(--role-text)' }}>{formatMoney(stats.totalAmount)}</h3>
            </div>
          </>
        ) : user.role === 'supervisor' ? (
          <>
            <div className="stat-card group relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-[var(--role-secondary)]/20 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              <p className="stat-label">Awaiting My Review</p>
              <h3 className="stat-value" style={{ color: 'var(--role-secondary)' }}>{stats.pendingSupervisor}</h3>
            </div>
            <div className="stat-card group relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-[var(--role-text)]/20 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              <p className="stat-label">Pending Accounting</p>
              <h3 className="stat-value" style={{ color: 'var(--role-text)' }}>{stats.pendingAccounting}</h3>
            </div>
            <div className="stat-card group relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-[var(--role-primary)]/20 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              <p className="stat-label">Department Total</p>
              <h3 className="stat-value">{stats.total}</h3>
            </div>
            <div className="stat-card group relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/20 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              <p className="stat-label">Released Amount</p>
              <h3 className="stat-value" style={{ color: 'var(--role-text)' }}>{formatMoney(stats.releasedAmount)}</h3>
            </div>
          </>
        ) : user.role === 'super_admin' ? (
          <>
            <div className="stat-card group relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/20 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              <p className="stat-label">System Health</p>
              <h3 className="stat-value" style={{ color: systemHealth?.backend?.status === 'healthy' ? '#10B981' : '#EF4444' }}>
                {systemHealth?.backend?.status === 'healthy' ? 'Healthy' : 'Degraded'}
              </h3>
            </div>
            <div className="stat-card group relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/20 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              <p className="stat-label">Database Status</p>
              <h3 className="stat-value" style={{ color: systemHealth?.supabase?.status === 'healthy' ? '#10B981' : '#EF4444' }}>
                {systemHealth?.supabase?.status === 'healthy' ? 'Connected' : 'Error'}
              </h3>
            </div>
            <div className="stat-card group relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-[var(--role-primary)]/20 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              <p className="stat-label">Total Users</p>
              <h3 className="stat-value">{systemHealth?.counts?.users || 0}</h3>
            </div>
            <div className="stat-card group relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-[var(--role-secondary)]/20 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              <p className="stat-label">Active Departments</p>
              <h3 className="stat-value">{systemHealth?.counts?.departments || 0}</h3>
            </div>
          </>
        ) : (
          <>
            <div className="stat-card group relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-[var(--role-text)]/20 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              <p className="stat-label">Awaiting Release</p>
              <h3 className="stat-value" style={{ color: 'var(--role-text)' }}>{stats.pendingAccounting}</h3>
            </div>
            <div className="stat-card group relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-[var(--role-primary)]/20 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              <p className="stat-label">Total Requests</p>
              <h3 className="stat-value">{stats.total}</h3>
            </div>
            <div className="stat-card group relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/20 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              <p className="stat-label">Total Released</p>
              <h3 className="stat-value" style={{ color: 'var(--role-text)' }}>{formatMoney(stats.releasedAmount)}</h3>
            </div>
            <div className="stat-card group relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-[var(--role-secondary)]/20 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              <p className="stat-label">Pending Amount</p>
              <h3 className="stat-value" style={{ color: 'var(--role-secondary)' }}>{formatMoney(stats.pendingAmount)}</h3>
            </div>
          </>
        )}
      </div>

      <div className="mb-8 grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="panel">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold text-[var(--role-text)]">{getRoleFocus(user.role)}</h2>
              <p className="mt-2 text-sm text-[var(--role-text)]/70">
                {user.role === 'employee'
                  ? 'Track your budget requests and their approval progress.'
                  : user.role === 'supervisor'
                  ? 'Review and approve department requests efficiently.'
                  : user.role === 'super_admin'
                  ? 'Overview of system-wide request activity and status.'
                  : 'Process fund releases and monitor financial flows.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3">
              {(user.role === 'supervisor' || user.role === 'accounting' || user.role === 'admin') && (
                <div className="flex items-center overflow-hidden rounded-full border border-[var(--role-border)] bg-[var(--role-accent)] p-1">
                  {[
                    { key: 'active', label: 'Active' },
                    { key: 'archived', label: 'Archived' },
                    { key: 'all', label: 'All' }
                  ].map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => {
                        setArchiveView(option.key as 'active' | 'archived' | 'all');
                        setFlowPage(1);
                      }}
                      className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${
                        archiveView === option.key
                          ? 'bg-[var(--role-surface)] text-[var(--role-text)] shadow-sm'
                          : 'text-[var(--role-text)]/60 hover:text-[var(--role-text)]'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
              {user.role !== 'employee' && user.role !== 'super_admin' && (
                <div className="rounded-full border border-[var(--role-border)] bg-[var(--role-accent)] px-4 py-2 text-sm text-[var(--role-text)]/70">
                  Total Amount: <span className="font-semibold text-[var(--role-text)]">{formatMoney(stats.totalAmount)}</span>
                </div>
              )}
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {user.role !== 'employee' && user.role !== 'super_admin' && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="panel-muted !p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/50">Pending Amount</p>
                  <p className="mt-2 text-lg font-semibold text-[var(--role-text)]">{formatMoney(stats.pendingAmount)}</p>
                  <p className="mt-1 text-xs text-[var(--role-text)]/60">Requests still waiting for action</p>
                </div>
                <div className="panel-muted !p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/50">Released Amount</p>
                  <p className="mt-2 text-lg font-semibold text-[var(--role-text)]">{formatMoney(stats.releasedAmount)}</p>
                  <p className="mt-1 text-xs text-[var(--role-text)]/60">Requests already released</p>
                </div>
                <div className="panel-muted !p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/50">Rejected Amount</p>
                  <p className="mt-2 text-lg font-semibold text-[var(--role-text)]">{formatMoney(stats.rejectedAmount)}</p>
                  <p className="mt-1 text-xs text-[var(--role-text)]/60">Requests declined in review</p>
                </div>
              </div>
            )}

            {recentRequests.length === 0 && (
              <div className="panel-muted">
                <p className="text-[var(--role-text)]/72">No requests available yet.</p>
              </div>
            )}

            {paginatedRequests.map((request: any) => (
              <div key={request.id} className="rounded-[24px] border border-[var(--role-border)] bg-[var(--role-accent)] p-4 transition-all hover:border-[var(--role-secondary)]/30">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <h3 className="break-words text-lg font-semibold text-[var(--role-text)]">{request.item_name}</h3>
                    <p className="mt-1 break-words text-sm text-[var(--role-text)]/60">
                      {request.request_code} • {request.category} {user.role !== 'super_admin' && `• ${formatMoney(toNumber(request.amount))}`}
                    </p>
                    <p className="mt-1 text-sm text-[var(--role-secondary)]">
                      Requested by <span className="font-semibold text-[var(--role-text)]">{getRequesterName(request)}</span>
                      <span className="text-[var(--role-text)]/60"> • {getRequesterDepartment(request)}</span>
                    </p>
                    <p className="mt-2 text-sm text-[var(--role-text)]/80">{getStatusLabel(request.status)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${getStatusTone(request.status)}`}>
                      {getStatusLabel(request.status)}
                    </span>
                    {(user.role === 'supervisor' || user.role === 'accounting' || user.role === 'admin') && ['released', 'rejected'].includes(request.status) && (
                      <button
                        type="button"
                        onClick={() => void toggleArchive(request.id, !request.archived)}
                        className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                          request.archived
                            ? 'border-emerald-300/30 bg-emerald-500/12 text-emerald-700'
                            : 'border-amber-300/30 bg-amber-500/12 text-amber-700'
                        }`}
                      >
                        {request.archived ? 'Unarchive' : 'Archive'}
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-4 rounded-[22px] border border-[var(--role-border)] bg-[var(--role-surface)] p-3">
                  <div className="mb-3 h-2 overflow-hidden rounded-full bg-[var(--role-accent)]">
                    <div className="flex h-full w-full">
                      <div className="h-full flex-1 bg-[var(--role-secondary)]" />
                      <div className={`h-full flex-1 ${request.status === 'pending_supervisor' ? 'bg-[var(--role-text)]/20' : ['pending_accounting', 'approved', 'released', 'rejected'].includes(request.status) ? 'bg-[var(--role-secondary)]' : 'bg-[var(--role-accent)]'}`} />
                      <div className={`h-full flex-1 ${request.status === 'pending_accounting' ? 'bg-[var(--role-text)]/20' : ['approved', 'released'].includes(request.status) ? 'bg-[var(--role-secondary)]' : 'bg-[var(--role-accent)]'}`} />
                      <div className={`h-full flex-1 ${request.status === 'released' ? 'bg-[var(--role-text)]/20' : request.status === 'approved' ? 'bg-[var(--role-secondary)]' : 'bg-[var(--role-accent)]'}`} />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {[
                    { key: 'submitted', label: 'Submitted', active: true, icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
                    {
                      key: 'supervisor',
                      label: 'Supervisor',
                      active: ['pending_accounting', 'approved', 'released', 'rejected'].includes(request.status),
                      current: request.status === 'pending_supervisor',
                      icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z'
                    },
                    {
                      key: 'accounting',
                      label: 'Accounting',
                      active: ['approved', 'released'].includes(request.status),
                      current: request.status === 'pending_accounting',
                      icon: 'M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z'
                    },
                    {
                      key: 'released',
                      label: 'Released',
                      active: request.status === 'released' || request.status === 'approved',
                      current: request.status === 'released',
                      icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                    }
                  ].map((step) => (
                    <div key={step.key} className="rounded-2xl border border-[var(--role-border)] bg-[var(--role-accent)] p-3 transition-all">
                      <div className="flex items-center gap-2">
                        <span
                          className={`flex h-5 w-5 items-center justify-center rounded-full ${
                            step.current 
                              ? 'bg-[var(--role-text)]' 
                              : step.active 
                                ? 'bg-[var(--role-secondary)]' 
                                : 'bg-[var(--role-border)]'
                          }`}
                        >
                          {step.active && !step.current ? (
                            <svg className="h-3 w-3 text-[var(--role-text-inverse)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : step.current ? (
                            <svg className="h-3 w-3 text-[var(--role-text-inverse)] animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          ) : null}
                        </span>
                        <span className={`text-sm ${step.current ? 'text-[var(--role-text)] font-semibold' : step.active ? 'text-[var(--role-text)]/90' : 'text-[var(--role-text)]/40'}`}>{step.label}</span>
                      </div>
                    </div>
                  ))}
                  </div>
                </div>
              </div>
            ))}

            {recentRequests.length > pageSize && (
              <div className="flex items-center justify-between gap-3 rounded-[22px] border border-[var(--role-border)] bg-[var(--role-accent)] px-4 py-3">
                <p className="text-sm text-[var(--role-text)]/60">
                  Page <span className="font-semibold text-[var(--role-text)]">{flowPage}</span> of <span className="font-semibold text-[var(--role-text)]">{totalFlowPages}</span>
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setFlowPage((current) => Math.max(1, current - 1))}
                    disabled={flowPage === 1}
                    className="btn-secondary !px-4 !py-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => setFlowPage((current) => Math.min(totalFlowPages, current + 1))}
                    disabled={flowPage === totalFlowPages}
                    className="btn-secondary !px-4 !py-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="panel">
            <h2 className="text-2xl font-bold text-[var(--role-text)]">
              {user.role === 'employee' ? 'Your Tasks' : user.role === 'supervisor' ? 'Approval Queue' : user.role === 'super_admin' ? 'Root Access' : 'Financial Controls'}
            </h2>
            <p className="mt-2 text-sm text-[var(--role-text)]/70">
              {user.role === 'employee' 
                ? 'Submit and track your budget requests.' 
                : user.role === 'supervisor' 
                ? 'Manage team requests awaiting your review.' 
                : user.role === 'super_admin'
                ? 'Manage system-wide permissions and monitor overall health.'
                : 'Oversee fund releases and financial reports.'}
            </p>
            <div className="mt-5 grid grid-cols-1 gap-3">
              {user.role === 'employee' && (
                <>
                  <button onClick={() => navigate('/request')} className="btn-primary w-full !justify-start items-center gap-4 min-h-[72px]">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--role-text-inverse)]/20">
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                    </span>
                    Submit New Request
                  </button>
                  <button onClick={() => navigate('/tracker')} className="btn-secondary w-full !justify-start items-center gap-4 min-h-[72px]">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--role-text)]/5">
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                    </span>
                    View My Requests
                  </button>
                </>
              )}
              {user.role === 'supervisor' && (
                <>
                  <button onClick={() => navigate('/approvals')} className="relative btn-primary w-full !justify-center items-center gap-4 min-h-[72px] px-14">
                    <span className="absolute left-4 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--role-text-inverse)]/20">
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </span>
                    <span className="font-semibold">Review Team Requests</span>
                    {stats.pendingSupervisor > 0 && (
                      <span className="absolute right-4 inline-flex items-center rounded-full bg-white/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-white">
                        {stats.pendingSupervisor} pending
                      </span>
                    )}
                  </button>
                  <button onClick={() => navigate('/reports')} className="btn-secondary w-full !justify-start items-center gap-4 min-h-[72px]">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--role-text)]/5">
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                    </span>
                    Department Analytics
                  </button>
                </>
              )}
              {user.role === 'accounting' && (
                <>
                  <button onClick={() => navigate('/approvals')} className="relative btn-primary w-full !justify-center items-center gap-4 min-h-[72px] px-14">
                    <span className="absolute left-4 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--role-text-inverse)]/20">
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </span>
                    <span className="font-semibold">Process Fund Releases</span>
                    {stats.pendingAccounting > 0 && (
                      <span className="absolute right-4 inline-flex items-center rounded-full bg-white/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-white">
                        {stats.pendingAccounting} pending
                      </span>
                    )}
                  </button>
                  <button onClick={() => navigate('/admin')} className="btn-secondary w-full !justify-start items-center gap-4 min-h-[72px]">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--role-text)]/5">
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    </span>
                    Budget Matrix
                  </button>
                </>
              )}
              {user.role === 'admin' && (
                <>
                  <button onClick={() => navigate('/admin')} className="btn-primary w-full !justify-start items-center gap-4 min-h-[72px]">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--role-text-inverse)]/20">
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </span>
                    System Administration
                  </button>
                  <button onClick={() => navigate('/reports')} className="btn-secondary w-full !justify-start items-center gap-4 min-h-[72px]">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--role-text)]/5">
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                      </svg>
                    </span>
                    System Reports
                  </button>
                </>
              )}
              {user.role === 'super_admin' && (
                <>
                  <button onClick={() => navigate('/admin')} className="btn-primary w-full !justify-start items-center gap-4 min-h-[72px]">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--role-text-inverse)]/20">
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    </span>
                    Root
                  </button>
                  <button onClick={() => navigate('/')} className="btn-secondary w-full !justify-start items-center gap-4 min-h-[72px]">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--role-text)]/5">
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                      </svg>
                    </span>
                    Overview
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="panel">
            <h2 className="text-2xl font-bold text-[var(--role-text)]">Activity Feed</h2>
            <p className="mt-2 text-sm text-[var(--role-text)]/70">Recent updates and transitions from the budget workflow.</p>
            <div className="mt-5 space-y-3">
              {condensedTimeline.length === 0 ? (
                <div className="panel-muted">
                  <p className="text-[var(--role-text)]/72">No timeline activity available yet.</p>
                </div>
              ) : (
                condensedTimeline.slice(0, 4).map((log: any) => (
                  <div key={log.id} className="rounded-2xl border border-[var(--role-border)] bg-[var(--role-accent)] p-4 transition-all hover:border-[var(--role-secondary)]/30">
                    <div className="flex gap-3">
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--role-secondary)]/10 text-[var(--role-secondary)]">
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[var(--role-text)] capitalize">{log.action} • {log.stage}</p>
                        <p className="mt-0.5 text-xs text-[var(--role-text)]/80">
                          {log.note || 'No note provided.'}
                          {log.count > 1 ? ` (${log.count} similar entries)` : ''}
                        </p>
                        <p className="mt-1 text-xs text-[var(--role-text)]/50">
                          {log.actor_name || 'System'} {log.actor_role ? `• ${log.actor_role}` : ''} • {new Date(log.latestTimestamp).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
              {condensedTimeline.length > 4 && (
                <div className="panel-muted text-sm text-[var(--role-text)]/70">
                  Showing latest 4 timeline entries of {condensedTimeline.length}. Open Request Tracker for full history.
                </div>
              )}
            </div>
          </div>

          <div className="panel">
          <h2 className="text-2xl font-bold text-[var(--role-text)]">
            {user.role === 'employee' ? 'Request Guide' : user.role === 'supervisor' ? 'Review Guide' : user.role === 'super_admin' ? 'System Guide' : 'Release Guide'}
          </h2>
          <div className="mt-5 space-y-3">
            {user.role === 'employee' ? (
              <>
                {[
                  ['Awaiting Supervisor', 'Your request is being reviewed by your department head.'],
                  ['Awaiting Accounting', 'Your supervisor approved it; finance is now reviewing.'],
                  ['Released', 'Your budget has been approved and released.'],
                  ['Not Approved', 'Your request was declined. You may revise and resubmit.']
                ].map(([title, copy]) => (
                  <div key={title} className="panel-muted">
                    <p className="font-semibold text-[var(--role-text)]">{title}</p>
                    <p className="mt-1 text-sm text-[var(--role-text)]/90">{copy}</p>
                  </div>
                ))}
              </>
            ) : user.role === 'supervisor' ? (
              <>
                {[
                  ['New Submission', 'Awaiting your initial review and approval decision.'],
                  ['Forwarded to Accounting', 'You approved it; finance will handle the release.'],
                  ['Released', 'Budget has been released to the requester.'],
                  ['Rejected', 'You declined the request; requester has been notified.']
                ].map(([title, copy]) => (
                  <div key={title} className="panel-muted">
                    <p className="font-semibold text-[var(--role-text)]">{title}</p>
                    <p className="mt-1 text-sm text-[var(--role-text)]/90">{copy}</p>
                  </div>
                ))}
              </>
            ) : user.role === 'super_admin' ? (
              <>
                {[
                  ['User Management', 'Create, update, or remove users and assign roles.'],
                  ['System Health', 'Monitor backend and database connectivity status.'],
                  ['Audit Logs', 'Review all major actions taken across the system.'],
                  ['Department Control', 'Manage department structures and fiscal years.']
                ].map(([title, copy]) => (
                  <div key={title} className="panel-muted">
                    <p className="font-semibold text-[var(--role-text)]">{title}</p>
                    <p className="mt-1 text-sm text-[var(--role-text)]/90">{copy}</p>
                  </div>
                ))}
              </>
            ) : (
              <>
                {[
                  ['Supervisor Approved', 'Ready for your financial review and fund release.'],
                  ['Fund Released', 'Budget has been successfully released to the department.'],
                  ['On Hold', 'Request requires additional documentation or clarification.'],
                  ['Rejected', 'Request does not meet financial requirements.']
                ].map(([title, copy]) => (
                  <div key={title} className="panel-muted">
                    <p className="font-semibold text-[var(--role-text)]">{title}</p>
                    <p className="mt-1 text-sm text-[var(--role-text)]/90">{copy}</p>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;