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
    case 'returned_for_revision':
      return 'Returned for Revision';
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
    case 'pending_supervisor': return 'border-[var(--role-secondary)]/28 bg-[var(--role-primary)]/55 text-[var(--role-text)]';
    case 'pending_accounting': return 'border-[var(--role-secondary)]/32 bg-[var(--role-secondary)]/18 text-[var(--role-text)]';
    case 'approved':
    case 'released': return 'border-[var(--role-text)]/24 bg-[var(--role-text)]/12 text-[var(--role-text)]';
    case 'returned_for_revision': return 'border-[var(--role-secondary)]/22 bg-[var(--role-primary)]/24 text-[var(--role-text)]';
    case 'rejected': return 'border-[var(--role-secondary)]/18 bg-[#192338] text-[var(--role-text)]/84';
    default: return 'border-[var(--role-secondary)]/14 bg-[#1E2F4F]/60 text-white';
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
    description: status === 'pending_supervisor' ? 'Waiting for supervisor approval.' : status === 'returned_for_revision' ? 'Returned during review.' : 'Supervisor stage completed.',
    state: status === 'pending_supervisor' ? 'current' : ['pending_accounting', 'approved', 'released', 'rejected', 'returned_for_revision'].includes(status) ? 'done' : 'idle'
  },
  {
    key: 'accounting',
    label: 'Accounting Review',
    description: status === 'pending_accounting' ? 'Waiting for accounting approval.' : status === 'returned_for_revision' ? 'Returned for correction.' : 'Accounting stage completed.',
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
  const [liquidationDraft, setLiquidationDraft] = useState({ actual_amount: '', remarks: '', file_url: '' });
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'date' | 'amount'>('date');

  const filteredRequests = useMemo(() => {
    let filtered = [...requests];

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(req =>
        req.item_name?.toLowerCase().includes(query) ||
        req.request_code?.toLowerCase().includes(query) ||
        req.category?.toLowerCase().includes(query) ||
        req.status?.toLowerCase().includes(query)
      );
    }

    if (statusFilter !== 'all') {
      filtered = filtered.filter(req => req.status === statusFilter);
    }

    filtered.sort((a, b) => {
      if (sortBy === 'date') {
        return new Date(b.submitted_at || 0).getTime() - new Date(a.submitted_at || 0).getTime();
      }
      return Number(b.amount) - Number(a.amount);
    });

    return filtered;
  }, [requests, searchQuery, statusFilter, sortBy]);

  useEffect(() => {
    fetchRequests();
    const intervalId = window.setInterval(() => {
      fetchRequests(false);
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, []);

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
      }
    } catch {
      if (showError) toast.error('Failed to fetch requests');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // In a real app, you would upload to Supabase Storage or similar.
      // For now, we simulate a URL.
      setLiquidationDraft(current => ({ ...current, file_url: URL.createObjectURL(file) }));
      toast.success('Image attached!');
    }
  };

  const selectedFlow = useMemo(
    () => (selectedRequest ? buildFlow(selectedRequest.status) : []),
    [selectedRequest]
  );

  const resubmitRequest = async () => {
    if (!selectedRequest) return;
    const token = localStorage.getItem('token');
    try {
      await api.patch(
        `/api/requests/${selectedRequest.id}/resubmit`,
        { purpose: selectedRequest.purpose },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      toast.success('Request resubmitted!');
      await fetchRequests(false);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Resubmission failed');
    }
  };

  const submitLiquidation = async () => {
    if (!selectedRequest) return;
    const token = localStorage.getItem('token');
    try {
      await api.patch(
        `/api/requests/${selectedRequest.id}/liquidation`,
        {
          actual_amount: Number(liquidationDraft.actual_amount),
          remarks: liquidationDraft.remarks,
          attachment_url: liquidationDraft.file_url
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      toast.success('Liquidation submitted!');
      setLiquidationDraft({ actual_amount: '', remarks: '', file_url: '' });
      await fetchRequests(false);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Liquidation failed');
    }
  };

  return (
    <div className="text-white">
      <div className="page-header">
        <h1 className="page-title">Request History</h1>
        <p className="page-subtitle">Track your submitted requests and monitor their progress through the approval pipeline.</p>
      </div>

      <div className="mb-4 panel">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              className="field-input"
              placeholder="Search by item, code, category..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          <select className="field-input w-auto" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">All Status</option>
            <option value="pending_supervisor">Pending Supervisor</option>
            <option value="pending_accounting">Pending Accounting</option>
            <option value="approved">Approved</option>
            <option value="released">Released</option>
            <option value="rejected">Rejected</option>
            <option value="returned_for_revision">Returned</option>
          </select>
          <select className="field-input w-auto" value={sortBy} onChange={e => setSortBy(e.target.value as 'date' | 'amount')}>
            <option value="date">Sort by Date</option>
            <option value="amount">Sort by Amount</option>
          </select>
        </div>
        <p className="mt-2 text-sm text-[#D9E1F1]/60">{filteredRequests.length} of {requests.length} requests</p>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-4">
          {filteredRequests.map((req) => (
            <div
              key={req.id}
              className={`panel cursor-pointer transition hover:border-white/20 hover:bg-slate-950/45 ${selectedRequest?.id === req.id ? 'border-[#8FB3E2]/28 bg-[#31487A]/18' : ''}`}
              onClick={() => {
                setSelectedRequest(req);
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
            </div>

            {selectedRequest.allocations?.length > 0 && (
              <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                {selectedRequest.allocations.map((allocation: any) => (
                  <div key={`${selectedRequest.id}-${allocation.department_id}`} className="panel-muted">
                    <p className="text-xs uppercase tracking-[0.16em] text-[#D9E1F1]/60">{allocation.department_name}</p>
                    <p className="mt-2 text-lg font-semibold text-white">{formatMoney(toNumber(allocation.amount))}</p>
                  </div>
                ))}
              </div>
            )}

            {selectedRequest.attachments?.length > 0 && (
              <div className="mt-4">
                <h3 className="text-lg font-semibold text-white">Supporting Documents</h3>
                <div className="mt-3 space-y-3">
                  {selectedRequest.attachments.map((attachment: any) => (
                    <div key={attachment.id} className="panel-muted flex items-center justify-between gap-4">
                      <div>
                        <p className="font-semibold text-white">{attachment.file_name}</p>
                        <p className="mt-1 text-sm uppercase tracking-[0.12em] text-[#D9E1F1]/60">{attachment.attachment_type || attachment.attachment_scope}</p>
                      </div>
                      <a className="btn-secondary" href={attachment.file_url} target="_blank" rel="noreferrer">
                        Open
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedRequest.release_method && (
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="panel-muted">
                  <p className="text-xs uppercase tracking-[0.16em] text-[#D9E1F1]/60">Release Method</p>
                  <p className="mt-2 text-lg font-semibold text-white capitalize">{selectedRequest.release_method.replace(/_/g, ' ')}</p>
                </div>
                <div className="panel-muted">
                  <p className="text-xs uppercase tracking-[0.16em] text-[#D9E1F1]/60">Reference</p>
                  <p className="mt-2 text-lg font-semibold text-white">{selectedRequest.release_reference_no || 'No reference'}</p>
                </div>
              </div>
            )}

            {selectedRequest.latest_liquidation && (
              <div className="panel-muted mt-4">
                <p className="text-xs uppercase tracking-[0.16em] text-[#D9E1F1]/60">Latest Liquidation</p>
                <p className="mt-2 text-lg font-semibold capitalize text-white">{selectedRequest.latest_liquidation.status.replace(/_/g, ' ')}</p>
                <p className="mt-2 text-sm text-[#D9E1F1]/76">
                  Due: {selectedRequest.latest_liquidation.due_at ? new Date(selectedRequest.latest_liquidation.due_at).toLocaleDateString() : 'No due date'}
                </p>
                <p className="mt-1 text-sm text-[#D9E1F1]/76">
                  Actual amount: {selectedRequest.latest_liquidation.actual_amount ? formatMoney(toNumber(selectedRequest.latest_liquidation.actual_amount)) : 'Not submitted'}
                </p>
                {selectedRequest.latest_liquidation.remarks && (
                  <p className="mt-1 text-sm text-[#D9E1F1]/76">{selectedRequest.latest_liquidation.remarks}</p>
                )}
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

            {selectedRequest.return_reason && (
              <div className="panel-muted mt-6 border-[#8FB3E2]/16 bg-[#192338]">
                <p className="text-xs uppercase tracking-[0.16em] text-[#D9E1F1]/68">Return Reason</p>
                <p className="mt-2 text-[#D9E1F1]">{selectedRequest.return_reason}</p>
                <p className="mt-2 text-xs text-[#D9E1F1]/56">Revision count: {selectedRequest.revision_count || 0}</p>
                <button className="btn-primary mt-4" onClick={() => void resubmitRequest()}>
                  Resubmit Request
                </button>
              </div>
            )}

            {selectedRequest.status === 'released' && (
              <div className="panel-muted mt-6">
                <p className="text-xs uppercase tracking-[0.16em] text-[#D9E1F1]/68">Submit Liquidation</p>
                <div className="mt-4 grid grid-cols-1 gap-3">
                  <input
                    type="number"
                    step="0.01"
                    className="field-input"
                    placeholder="Actual amount spent"
                    value={liquidationDraft.actual_amount}
                    onChange={(event) => setLiquidationDraft((current) => ({ ...current, actual_amount: event.target.value }))}
                  />
                  <textarea
                    className="field-input min-h-[120px]"
                    placeholder="Liquidation remarks"
                    value={liquidationDraft.remarks}
                    onChange={(event) => setLiquidationDraft((current) => ({ ...current, remarks: event.target.value }))}
                  />
                  
                  <div className="flex flex-col gap-3">
                    <label className="text-xs uppercase tracking-[0.16em] text-[#D9E1F1]/60">Attach Official Receipt / Image</label>
                    <div className="relative">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleFileChange}
                        className="hidden"
                        id="liquidation-attachment"
                      />
                      <label
                        htmlFor="liquidation-attachment"
                        className="flex w-full cursor-pointer items-center justify-center gap-3 rounded-[22px] border border-dashed border-[#8FB3E2]/30 bg-black/10 py-6 transition hover:border-[#8FB3E2]/50 hover:bg-black/20"
                      >
                        <span className="text-2xl">📸</span>
                        <span className="text-sm font-semibold text-[#D9E1F1]">
                          {liquidationDraft.file_url ? 'Change Image' : 'Click to Upload Receipt'}
                        </span>
                      </label>
                    </div>
                    {liquidationDraft.file_url && (
                      <div className="mt-2 overflow-hidden rounded-2xl border border-[#8FB3E2]/20">
                        <img 
                          src={liquidationDraft.file_url} 
                          alt="Liquidation attachment" 
                          className="h-auto max-h-[200px] w-full object-contain bg-black/20" 
                        />
                      </div>
                    )}
                  </div>

                  <button className="btn-primary" onClick={() => void submitLiquidation()}>
                    Submit Liquidation
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default RequestTracker;
