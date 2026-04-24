import { useEffect, useMemo, useState } from 'react';
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

const getStatusColor = (status: string) => {
  switch (status) {
    case 'pending_supervisor': return 'border-[#8FB3E2]/28 bg-[#31487A]/55 text-[#D9E1F1]';
    case 'pending_accounting': return 'border-[#8FB3E2]/32 bg-[#8FB3E2]/18 text-[#D9E1F1]';
    case 'approved':
    case 'released': return 'border-[#D9E1F1]/24 bg-[#D9E1F1]/12 text-[#D9E1F1]';
    case 'rejected': return 'border-[#8FB3E2]/18 bg-[#192338] text-[#D9E1F1]/84';
    default: return 'border-[#8FB3E2]/14 bg-[#1E2F4F]/60 text-white';
  }
};

const buildFlow = (status: string) => [
  {
    key: 'submitted',
    label: 'Submitted',
    description: 'Your request has been created.',
    state: ['pending_supervisor', 'pending_accounting', 'approved', 'released', 'rejected'].includes(status) ? 'done' : 'idle'
  },
  {
    key: 'supervisor',
    label: 'Supervisor Review',
    description: status === 'pending_supervisor' ? 'Waiting for supervisor approval.' : 'Supervisor stage completed.',
    state: status === 'pending_supervisor' ? 'current' : ['pending_accounting', 'approved', 'released', 'rejected'].includes(status) ? 'done' : 'idle'
  },
  {
    key: 'accounting',
    label: 'Accounting Review',
    description: status === 'pending_accounting' ? 'Waiting for accounting approval.' : 'Accounting stage completed.',
    state: status === 'pending_accounting' ? 'current' : ['approved', 'released'].includes(status) ? 'done' : 'idle'
  },
  {
    key: 'released',
    label: 'Release',
    description: status === 'released' || status === 'approved' ? 'Budget has been released.' : 'Pending final release.',
    state: status === 'released' || status === 'approved' ? 'done' : 'idle'
  }
];

const RequestTracker = () => {
  const [requests, setRequests] = useState<any[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<any>(null);
  const [timeline, setTimeline] = useState<any[]>([]);

  useEffect(() => {
    fetchRequests();
    const intervalId = window.setInterval(() => {
      fetchRequests(false);
      if (selectedRequest?.id) {
        fetchTimeline(selectedRequest.id, false);
      }
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [selectedRequest?.id]);

  const fetchRequests = async (showError = true) => {
    const token = localStorage.getItem('token');
    try {
      const res = await api.get('/api/requests', { headers: { Authorization: `Bearer ${token}` } });
      setRequests(res.data);
      if (selectedRequest?.id) {
        const refreshedSelection = res.data.find((request: any) => request.id === selectedRequest.id);
        if (refreshedSelection) {
          setSelectedRequest(refreshedSelection);
        }
      } else if (res.data.length > 0) {
        setSelectedRequest(res.data[0]);
        fetchTimeline(res.data[0].id, false);
      }
    } catch {
      if (showError) toast.error('Failed to fetch requests');
    }
  };

  const fetchTimeline = async (id: string, showError = true) => {
    const token = localStorage.getItem('token');
    try {
      const res = await api.get(`/api/requests/${id}/timeline`, { headers: { Authorization: `Bearer ${token}` } });
      setTimeline(res.data);
    } catch {
      if (showError) toast.error('Failed to fetch timeline');
    }
  };

  const selectedFlow = useMemo(
    () => (selectedRequest ? buildFlow(selectedRequest.status) : []),
    [selectedRequest]
  );
  const supervisorLogs = useMemo(
    () => timeline.filter((log: any) => log.approval_side === 'supervisor' || log.action === 'submitted'),
    [timeline]
  );
  const accountingLogs = useMemo(
    () => timeline.filter((log: any) => log.approval_side === 'accounting'),
    [timeline]
  );

  return (
    <div className="text-white">
      <div className="page-header">
        <h1 className="page-title">My Expense Requests</h1>
        <p className="page-subtitle">Every request now shows a clearer approval flow so you can immediately see where it is waiting.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-4">
          {requests.map((req) => (
            <div
              key={req.id}
              className={`panel cursor-pointer transition hover:border-white/20 hover:bg-slate-950/45 ${selectedRequest?.id === req.id ? 'border-[#8FB3E2]/28 bg-[#31487A]/18' : ''}`}
              onClick={() => {
                setSelectedRequest(req);
                fetchTimeline(req.id);
              }}
            >
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-white">{req.item_name}</h2>
                  <p className="mt-1 text-sm text-[#D9E1F1]/76">{formatMoney(toNumber(req.amount))} • {req.category}</p>
                  <p className="mt-2 text-sm text-[#D9E1F1]/88">{getStatusLabel(req.status)}</p>
                </div>
                <span className={`badge ${getStatusColor(req.status)}`}>{getStatusLabel(req.status)}</span>
              </div>
              <div className="rounded-[22px] border border-[#8FB3E2]/10 bg-black/10 p-3">
                <div className="mb-3 h-2 overflow-hidden rounded-full bg-[#1E2F4F]">
                  <div className="flex h-full w-full">
                    {buildFlow(req.status).map((step) => (
                      <div
                        key={step.key}
                        className={`h-full flex-1 ${
                          step.state === 'current' ? 'bg-[#D9E1F1]' : step.state === 'done' ? 'bg-[#8FB3E2]' : 'bg-[#31487A]'
                        }`}
                      />
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm text-[#D9E1F1] md:grid-cols-4">
                  {buildFlow(req.status).map((step) => (
                    <div key={step.key} className="panel-muted flex items-start gap-2 !rounded-2xl !p-3">
                      <div
                        className={`mt-1 h-3 w-3 rounded-full ${
                          step.state === 'current' ? 'bg-[#D9E1F1]' : step.state === 'done' ? 'bg-[#8FB3E2]' : 'bg-[#1E2F4F]'
                        }`}
                      />
                      <div>
                        <p className="text-white">{step.label}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        {selectedRequest && (
          <div className="panel">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-2xl font-bold text-white">{selectedRequest.item_name}</h2>
                <p className="mt-2 text-[#D9E1F1]/82">{getStatusLabel(selectedRequest.status)}</p>
              </div>
              <span className={`badge ${getStatusColor(selectedRequest.status)}`}>{getStatusLabel(selectedRequest.status)}</span>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="panel-muted">
                <p className="text-xs uppercase tracking-[0.16em] text-[#D9E1F1]/60">Amount</p>
                <p className="mt-2 text-lg font-semibold text-white">{formatMoney(toNumber(selectedRequest.amount))}</p>
              </div>
              <div className="panel-muted">
                <p className="text-xs uppercase tracking-[0.16em] text-[#D9E1F1]/60">Category</p>
                <p className="mt-2 text-lg font-semibold text-white">{selectedRequest.category}</p>
              </div>
              <div className="panel-muted">
                <p className="text-xs uppercase tracking-[0.16em] text-[#D9E1F1]/60">Priority</p>
                <p className="mt-2 text-lg font-semibold capitalize text-white">{selectedRequest.priority}</p>
              </div>
              <div className="panel-muted">
                <p className="text-xs uppercase tracking-[0.16em] text-[#D9E1F1]/60">Current Status</p>
                <p className="mt-2 text-lg font-semibold text-white">{getStatusLabel(selectedRequest.status)}</p>
              </div>
              <div className="panel-muted">
                <p className="text-xs uppercase tracking-[0.16em] text-[#D9E1F1]/60">Department</p>
                <p className="mt-2 text-lg font-semibold text-white">{selectedRequest.department_name || 'Unknown department'}</p>
              </div>
              <div className="panel-muted">
                <p className="text-xs uppercase tracking-[0.16em] text-[#D9E1F1]/60">Fiscal Year</p>
                <p className="mt-2 text-lg font-semibold text-white">{selectedRequest.fiscal_year || selectedRequest.departments?.fiscal_year || 'N/A'}</p>
              </div>
              {selectedRequest.budget_summary && (
                <div className="panel-muted">
                  <p className="text-xs uppercase tracking-[0.16em] text-[#D9E1F1]/60">Projected Remaining</p>
                  <p className="mt-2 text-lg font-semibold text-white">{formatMoney(toNumber(selectedRequest.budget_summary.projected_remaining_budget))}</p>
                </div>
              )}
            </div>

            {selectedRequest.allocations?.length > 0 && (
              <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                {selectedRequest.allocations.map((allocation: any) => (
                  <div key={`${selectedRequest.id}-${allocation.department_id}`} className="panel-muted">
                    <p className="text-xs uppercase tracking-[0.16em] text-[#D9E1F1]/60">{allocation.department_name}</p>
                    <p className="mt-2 text-lg font-semibold text-white">{formatMoney(toNumber(allocation.amount))}</p>
                    <p className="mt-1 text-sm text-[#D9E1F1]/72">
                      Projected remaining {formatMoney(toNumber(allocation.projected_remaining_budget))}
                    </p>
                  </div>
                ))}
              </div>
            )}

            <div className="panel-muted mt-4">
              <p className="text-xs uppercase tracking-[0.16em] text-[#D9E1F1]/60">Purpose</p>
              <p className="mt-2 text-[#D9E1F1]/88">{selectedRequest.purpose || 'No purpose provided.'}</p>
            </div>

            <div className="mt-6">
              <h3 className="text-xl font-bold text-white">Approval Flow</h3>
              <div className="mt-4 rounded-[24px] border border-[#8FB3E2]/10 bg-black/10 p-4">
                <div className="mb-5 h-2 overflow-hidden rounded-full bg-[#1E2F4F]">
                  <div className="flex h-full w-full">
                    {selectedFlow.map((step) => (
                      <div
                        key={step.key}
                        className={`h-full flex-1 ${
                          step.state === 'current' ? 'bg-[#D9E1F1]' : step.state === 'done' ? 'bg-[#8FB3E2]' : 'bg-[#31487A]'
                        }`}
                      />
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  {selectedFlow.map((step, index) => (
                    <div key={step.key} className="flex gap-4">
                      <div className="flex flex-col items-center">
                        <div
                          className={`h-4 w-4 rounded-full ${
                            step.state === 'current' ? 'bg-[#D9E1F1]' : step.state === 'done' ? 'bg-[#8FB3E2]' : 'bg-[#31487A]'
                          }`}
                        />
                        {index !== selectedFlow.length - 1 && <div className="mt-2 h-full min-h-[28px] w-px bg-[#8FB3E2]/18" />}
                      </div>
                      <div className="panel-muted w-full">
                        <p className="font-semibold text-white">{step.label}</p>
                        <p className="mt-1 text-sm text-[#D9E1F1]/76">{step.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {selectedRequest.rejection_reason && (
              <div className="panel-muted mt-6 border-[#8FB3E2]/16 bg-[#192338]">
                <p className="text-xs uppercase tracking-[0.16em] text-[#D9E1F1]/68">Rejection Reason</p>
                <p className="mt-2 text-[#D9E1F1]">{selectedRequest.rejection_reason}</p>
              </div>
            )}

            <h3 className="mt-8 text-xl font-bold text-white">Timeline</h3>
            <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div className="space-y-3">
                <h4 className="text-sm font-semibold uppercase tracking-[0.14em] text-[#D9E1F1]/60">Supervisor Side</h4>
                {supervisorLogs.map((log: any) => (
                  <div key={log.id} className="panel-muted">
                    <p className="font-semibold capitalize text-white">{log.action} • {log.stage}</p>
                    <p className="mt-1 text-sm text-[#D9E1F1]/80">{log.note || 'No note provided.'}</p>
                    <p className="mt-2 text-xs text-[#D9E1F1]/56">
                      {log.actor_name || 'System'} {log.actor_role ? `• ${log.actor_role}` : ''} • {new Date(log.timestamp).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
              <div className="space-y-3">
                <h4 className="text-sm font-semibold uppercase tracking-[0.14em] text-[#D9E1F1]/60">Accounting Side</h4>
                {accountingLogs.map((log: any) => (
                  <div key={log.id} className="panel-muted">
                    <p className="font-semibold capitalize text-white">{log.action} • {log.stage}</p>
                    <p className="mt-1 text-sm text-[#D9E1F1]/80">{log.note || 'No note provided.'}</p>
                    <p className="mt-2 text-xs text-[#D9E1F1]/56">
                      {log.actor_name || 'System'} {log.actor_role ? `• ${log.actor_role}` : ''} • {new Date(log.timestamp).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default RequestTracker;
