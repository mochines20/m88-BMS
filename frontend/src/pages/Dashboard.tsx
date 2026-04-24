import { useEffect, useMemo, useState } from 'react';
import api from '../api';

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
      return 'border-[#8FB3E2]/22 bg-[#31487A]/34 text-white';
    case 'pending_accounting':
      return 'border-[#8FB3E2]/28 bg-[#8FB3E2]/16 text-white';
    case 'released':
    case 'approved':
      return 'border-[#D9E1F1]/18 bg-[#D9E1F1]/10 text-white';
    case 'rejected':
      return 'border-white/10 bg-white/5 text-[#D9E1F1]/82';
    default:
      return 'border-white/10 bg-white/5 text-white';
  }
};

const getRoleHeadline = (role?: string) => {
  switch (role) {
    case 'employee':
      return 'Track every request from submission to release.';
    case 'supervisor':
      return 'Monitor departmental requests and approval progress.';
    case 'accounting':
      return 'Review finance-stage requests and keep release status visible.';
    case 'admin':
      return 'See request movement and system-wide budget activity at a glance.';
    default:
      return 'Keep request status and approvals visible in one dashboard.';
  }
};

const getRoleFocus = (role?: string) => {
  switch (role) {
    case 'employee':
      return 'Your Request Flow';
    case 'supervisor':
      return 'Department Approval Flow';
    case 'accounting':
      return 'Accounting Release Flow';
    case 'admin':
      return 'System Request Visibility';
    default:
      return 'Request Flow';
  }
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
  const [user, setUser] = useState<any>(null);
  const [requests, setRequests] = useState<any[]>([]);
  const [timeline, setTimeline] = useState<any[]>([]);

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

    return {
      total,
      pendingSupervisor,
      pendingAccounting,
      released,
      rejected,
      totalAmount
    };
  }, [requests]);

  const recentRequests = useMemo(
    () => [...requests].sort((a: any, b: any) => new Date(b.submitted_at || b.updated_at).getTime() - new Date(a.submitted_at || a.updated_at).getTime()).slice(0, 6),
    [requests]
  );

  const condensedTimeline = useMemo(() => condenseLogs(timeline), [timeline]);

  if (!user) return <div className="text-white">Loading...</div>;

  return (
    <div className="text-white">
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">
          Welcome back, {user.name}. {getRoleHeadline(user.role)}
        </p>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <div className="stat-card">
          <p className="stat-label">Total Requests</p>
          <h3 className="stat-value">{stats.total}</h3>
        </div>
        <div className="stat-card">
          <p className="stat-label">Waiting Supervisor</p>
          <h3 className="stat-value text-[#8FB3E2]">{stats.pendingSupervisor}</h3>
        </div>
        <div className="stat-card">
          <p className="stat-label">Waiting Accounting</p>
          <h3 className="stat-value text-[#D9E1F1]">{stats.pendingAccounting}</h3>
        </div>
        <div className="stat-card">
          <p className="stat-label">Released / Approved</p>
          <h3 className="stat-value text-[#D9E1F1]">{stats.released}</h3>
        </div>
        <div className="stat-card">
          <p className="stat-label">Rejected</p>
          <h3 className="stat-value text-[#8FB3E2]/90">{stats.rejected}</h3>
        </div>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="panel">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold text-white">{getRoleFocus(user.role)}</h2>
              <p className="mt-2 text-sm text-[#D9E1F1]/72">Every request shows its current stage so status is always visible.</p>
            </div>
            <div className="rounded-full border border-[#8FB3E2]/14 bg-[#31487A]/24 px-4 py-2 text-sm text-[#D9E1F1]/82">
              Total Amount: <span className="font-semibold text-white">{formatMoney(stats.totalAmount)}</span>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {recentRequests.length === 0 && (
              <div className="panel-muted">
                <p className="text-[#D9E1F1]/72">No requests available yet.</p>
              </div>
            )}

            {recentRequests.map((request: any) => (
              <div key={request.id} className="rounded-[24px] border border-[#8FB3E2]/10 bg-[#192338]/34 p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <h3 className="break-words text-lg font-semibold text-white">{request.item_name}</h3>
                    <p className="mt-1 break-words text-sm text-[#D9E1F1]/72">
                      {request.request_code} • {request.category} • {formatMoney(toNumber(request.amount))}
                    </p>
                    <p className="mt-2 text-sm text-[#D9E1F1]/84">{getStatusLabel(request.status)}</p>
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${getStatusTone(request.status)}`}>
                    {getStatusLabel(request.status)}
                  </span>
                </div>

                <div className="mt-4 rounded-[22px] border border-[#8FB3E2]/10 bg-black/10 p-3">
                  <div className="mb-3 h-2 overflow-hidden rounded-full bg-[#1E2F4F]">
                    <div className="flex h-full w-full">
                      <div className="h-full flex-1 bg-[#8FB3E2]" />
                      <div className={`h-full flex-1 ${request.status === 'pending_supervisor' ? 'bg-[#D9E1F1]' : ['pending_accounting', 'approved', 'released', 'rejected'].includes(request.status) ? 'bg-[#8FB3E2]' : 'bg-[#31487A]'}`} />
                      <div className={`h-full flex-1 ${request.status === 'pending_accounting' ? 'bg-[#D9E1F1]' : ['approved', 'released'].includes(request.status) ? 'bg-[#8FB3E2]' : 'bg-[#31487A]'}`} />
                      <div className={`h-full flex-1 ${request.status === 'released' ? 'bg-[#D9E1F1]' : request.status === 'approved' ? 'bg-[#8FB3E2]' : 'bg-[#31487A]'}`} />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {[
                    { key: 'submitted', label: 'Submitted', active: true },
                    {
                      key: 'supervisor',
                      label: 'Supervisor',
                      active: ['pending_accounting', 'approved', 'released', 'rejected'].includes(request.status),
                      current: request.status === 'pending_supervisor'
                    },
                    {
                      key: 'accounting',
                      label: 'Accounting',
                      active: ['approved', 'released'].includes(request.status),
                      current: request.status === 'pending_accounting'
                    },
                    {
                      key: 'released',
                      label: 'Released',
                      active: request.status === 'released' || request.status === 'approved',
                      current: request.status === 'released'
                    }
                  ].map((step) => (
                    <div key={step.key} className="rounded-2xl border border-white/8 bg-black/10 p-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${
                            step.current ? 'bg-[#D9E1F1]' : step.active ? 'bg-[#8FB3E2]' : 'bg-[#31487A]'
                          }`}
                        />
                        <span className="text-sm text-white">{step.label}</span>
                      </div>
                    </div>
                  ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <h2 className="text-2xl font-bold text-white">Recent Timeline</h2>
          <p className="mt-2 text-sm text-[#D9E1F1]/72">Showing condensed history from the latest request.</p>
          <div className="mt-5 space-y-3">
            {condensedTimeline.length === 0 ? (
              <div className="panel-muted">
                <p className="text-[#D9E1F1]/72">No timeline activity available yet.</p>
              </div>
            ) : (
              condensedTimeline.slice(0, 4).map((log: any) => (
                <div key={log.id} className="panel-muted">
                  <p className="font-semibold capitalize text-white">{log.action} • {log.stage}</p>
                  <p className="mt-1 text-sm text-[#D9E1F1]/80">
                    {log.note || 'No note provided.'}
                    {log.count > 1 ? ` (${log.count} similar entries)` : ''}
                  </p>
                  <p className="mt-2 text-xs text-[#D9E1F1]/56">
                    {log.actor_name || 'System'} {log.actor_role ? `• ${log.actor_role}` : ''} • {new Date(log.latestTimestamp).toLocaleString()}
                  </p>
                </div>
              ))
            )}
            {condensedTimeline.length > 4 && (
              <div className="panel-muted text-sm text-[#D9E1F1]/70">
                Showing latest 4 timeline entries of {condensedTimeline.length}. Open Request Tracker for full history.
              </div>
            )}
          </div>
        </div>

        <div className="panel">
          <h2 className="text-2xl font-bold text-white">Status Guide</h2>
          <div className="mt-5 space-y-3">
            {[
              ['Waiting for Supervisor Approval', 'The request has been submitted and is waiting for department review.'],
              ['Waiting for Accounting Approval', 'The supervisor has approved it and finance review is next.'],
              ['Released', 'The request has cleared approvals and budget has been released.'],
              ['Rejected', 'The request was declined at one of the approval stages.']
            ].map(([title, copy]) => (
              <div key={title} className="panel-muted">
                <p className="font-semibold text-white">{title}</p>
                <p className="mt-1 text-sm text-[#D9E1F1]/72">{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
