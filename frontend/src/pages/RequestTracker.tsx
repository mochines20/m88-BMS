import { useEffect, useMemo, useState } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import FilePreviewer from '../components/FilePreviewer';
import { formatMoney, toNumber } from '../utils/format';

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
    case 'pending_supervisor': return 'border-[var(--role-secondary)]/30 bg-[var(--role-secondary)]/10 text-[var(--role-text)]';
    case 'pending_accounting': return 'border-[var(--role-primary)]/30 bg-[var(--role-primary)]/10 text-[var(--role-text)]';
    case 'approved':
    case 'released': return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700';
    case 'returned_for_revision': return 'border-orange-500/30 bg-orange-500/10 text-orange-700';
    case 'rejected': return 'border-red-500/30 bg-red-500/10 text-red-700';
    default: return 'border-[var(--role-border)] bg-[var(--role-accent)] text-[var(--role-text)]';
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
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [previewFile, setPreviewFile] = useState<{ url: string; name: string } | null>(null);

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

    if (dateStart) {
      const start = new Date(dateStart).getTime();
      filtered = filtered.filter(req => new Date(req.submitted_at).getTime() >= start);
    }

    if (dateEnd) {
      const end = new Date(dateEnd).getTime() + 86400000; // End of day
      filtered = filtered.filter(req => new Date(req.submitted_at).getTime() < end);
    }

    filtered.sort((a, b) => {
      if (sortBy === 'date') {
        return new Date(b.submitted_at || 0).getTime() - new Date(a.submitted_at || 0).getTime();
      }
      return Number(b.amount) - Number(a.amount);
    });

    return filtered;
  }, [requests, searchQuery, statusFilter, sortBy, dateStart, dateEnd]);

  const exportToCSV = () => {
    const headers = ['Request Code', 'Item Name', 'Category', 'Amount', 'Status', 'Submitted At', 'Priority'];
    const rows = filteredRequests.map(req => [
      req.request_code,
      req.item_name,
      req.category,
      req.amount,
      req.status,
      new Date(req.submitted_at).toLocaleString(),
      req.priority
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `requests_export_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const fetchRequests = async (showError = true, selectedId?: string) => {
    const token = localStorage.getItem('token');
    try {
      const res = await api.get('/api/requests', { headers: { Authorization: `Bearer ${token}` } });
      setRequests(res.data);
      
      const targetId = selectedId || selectedRequest?.id;
      if (targetId) {
        const refreshedSelection = res.data.find((request: any) => request.id === targetId);
        if (refreshedSelection) {
          setSelectedRequest(refreshedSelection);
        }
      } else if (res.data.length > 0 && !selectedRequest) {
        setSelectedRequest(res.data[0]);
      }
    } catch {
      if (showError) toast.error('Failed to fetch requests');
    }
  };

  useEffect(() => {
    void fetchRequests();

    // Supabase Realtime Subscription
    let channel: any;
    if (supabase) {
      channel = supabase
        .channel('tracker-changes')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'expense_requests' },
          () => {
            void fetchRequests(false);
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'approval_logs' },
          () => {
            void fetchRequests(false);
          }
        )
        .subscribe();
    }

    return () => {
      if (channel && supabase) {
        void supabase.removeChannel(channel);
      }
    };
  }, []);

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
    <div className="text-[var(--role-text)]">
      <div className="page-header">
        <h1 className="page-title">Request History</h1>
        <p className="page-subtitle">Track your submitted requests and monitor their progress through the approval pipeline.</p>
      </div>

      <div className="mb-4 panel">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div className="flex flex-wrap gap-3 flex-1">
            <div className="min-w-[200px] flex-1">
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
          <button 
            onClick={exportToCSV}
            className="btn-secondary flex items-center gap-2"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export CSV
          </button>
        </div>
        
        <div className="flex flex-wrap gap-4 items-center border-t border-[var(--role-border)] pt-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--role-text)]/60">From:</span>
            <input 
              type="date" 
              className="field-input !py-1.5" 
              value={dateStart}
              onChange={e => setDateStart(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--role-text)]/60">To:</span>
            <input 
              type="date" 
              className="field-input !py-1.5" 
              value={dateEnd}
              onChange={e => setDateEnd(e.target.value)}
            />
          </div>
          {(dateStart || dateEnd || searchQuery || statusFilter !== 'all') && (
            <button 
              onClick={() => {
                setDateStart('');
                setDateEnd('');
                setSearchQuery('');
                setStatusFilter('all');
              }}
              className="text-sm font-medium text-[var(--role-primary)] hover:underline"
            >
              Clear Filters
            </button>
          )}
        </div>
        
        <p className="mt-4 text-sm text-[var(--role-text)]/60">{filteredRequests.length} of {requests.length} requests</p>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-4">
          {filteredRequests.map((req) => (
            <div
              key={req.id}
              className={`panel cursor-pointer transition hover:border-[var(--role-secondary)]/30 ${selectedRequest?.id === req.id ? 'border-[var(--role-primary)]/40 bg-[var(--role-accent)] shadow-md' : ''}`}
              onClick={() => {
                setSelectedRequest(req);
              }}
            >
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-[var(--role-text)]">{req.item_name}</h2>
                  <p className="mt-1 text-sm text-[var(--role-text)]/70">{formatMoney(toNumber(req.amount))} • {req.category}</p>
                  <p className="mt-2 text-sm font-medium text-[var(--role-text)]/80">{getStatusLabel(req.status)}</p>
                </div>
                <span className={`badge ${getStatusColor(req.status)}`}>{getStatusLabel(req.status)}</span>
              </div>
              <div className="rounded-[22px] border border-[var(--role-border)] bg-[var(--role-bg-0)] p-3">
                <div className="mb-3 h-2 overflow-hidden rounded-full bg-[var(--role-border)]/20">
                  <div className="flex h-full w-full">
                    {buildFlow(req.status).map((step) => (
                      <div
                        key={step.key}
                        className={`h-full flex-1 ${
                          step.state === 'current' ? 'bg-[var(--role-secondary)]' : step.state === 'done' ? 'bg-[var(--role-primary)]' : 'bg-[var(--role-border)]/40'
                        }`}
                      />
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm text-[var(--role-text)] md:grid-cols-4">
                  {buildFlow(req.status).map((step) => (
                    <div key={step.key} className="panel-muted flex items-start gap-2 !rounded-2xl !p-3 bg-white/40">
                      <div
                        className={`mt-1.5 h-2 w-2 rounded-full ${
                          step.state === 'current' ? 'bg-[var(--role-secondary)]' : step.state === 'done' ? 'bg-[var(--role-primary)]' : 'bg-[var(--role-border)]'
                        }`}
                      />
                      <div>
                        <p className="font-semibold">{step.label}</p>
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
                <h2 className="text-2xl font-bold text-[var(--role-text)]">{selectedRequest.item_name}</h2>
                <p className="mt-2 text-[var(--role-text)]/70">{getStatusLabel(selectedRequest.status)}</p>
              </div>
              <span className="badge ${getStatusColor(selectedRequest.status)}">{getStatusLabel(selectedRequest.status)}</span>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="panel-muted bg-white/40">
                <p className="text-xs uppercase tracking-[0.16em] text-[var(--role-text)]/50 font-bold">Amount</p>
                <p className="mt-2 text-lg font-bold text-[var(--role-text)]">{formatMoney(toNumber(selectedRequest.amount))}</p>
              </div>
              <div className="panel-muted bg-white/40">
                <p className="text-xs uppercase tracking-[0.16em] text-[var(--role-text)]/50 font-bold">Category</p>
                <p className="mt-2 text-lg font-bold text-[var(--role-text)]">{selectedRequest.category}</p>
              </div>
              <div className="panel-muted bg-white/40">
                <p className="text-xs uppercase tracking-[0.16em] text-[var(--role-text)]/50 font-bold">Priority</p>
                <p className="mt-2 text-lg font-bold capitalize text-[var(--role-text)]">{selectedRequest.priority}</p>
              </div>
              <div className="panel-muted bg-white/40">
                <p className="text-xs uppercase tracking-[0.16em] text-[var(--role-text)]/50 font-bold">Current Status</p>
                <p className="mt-2 text-lg font-bold text-[var(--role-text)]">{getStatusLabel(selectedRequest.status)}</p>
              </div>
              <div className="panel-muted bg-white/40">
                <p className="text-xs uppercase tracking-[0.16em] text-[var(--role-text)]/50 font-bold">Department</p>
                <p className="mt-2 text-lg font-bold text-[var(--role-text)]">{selectedRequest.department_name || 'Unknown department'}</p>
              </div>
              <div className="panel-muted bg-white/40">
                <p className="text-xs uppercase tracking-[0.16em] text-[var(--role-text)]/50 font-bold">Fiscal Year</p>
                <p className="mt-2 text-lg font-bold text-[var(--role-text)]">{selectedRequest.fiscal_year || selectedRequest.departments?.fiscal_year || 'N/A'}</p>
              </div>
            </div>

            {selectedRequest.allocations?.length > 0 && (
              <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                {selectedRequest.allocations.map((allocation: any) => (
                  <div key={`${selectedRequest.id}-${allocation.department_id}`} className="panel-muted bg-white/40">
                    <p className="text-xs uppercase tracking-[0.16em] text-[var(--role-text)]/50 font-bold">{allocation.department_name}</p>
                    <p className="mt-2 text-lg font-bold text-[var(--role-text)]">{formatMoney(toNumber(allocation.amount))}</p>
                  </div>
                ))}
              </div>
            )}

            {selectedRequest.attachments?.length > 0 && (
              <div className="mt-4">
                <h3 className="text-lg font-bold text-[var(--role-text)]">Supporting Documents</h3>
                <div className="mt-3 space-y-3">
                  {selectedRequest.attachments.map((attachment: any) => (
                    <div key={attachment.id} className="panel-muted flex items-center justify-between gap-4 bg-white/40">
                      <div>
                        <p className="font-bold text-[var(--role-text)]">{attachment.file_name}</p>
                        <p className="mt-1 text-sm uppercase tracking-[0.12em] text-[var(--role-text)]/50">{attachment.attachment_type || attachment.attachment_scope}</p>
                      </div>
                      <button 
                        className="btn-secondary" 
                        onClick={() => setPreviewFile({ url: attachment.file_url, name: attachment.file_name })}
                      >
                        Preview
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedRequest.release_method && (
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="panel-muted bg-white/40">
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--role-text)]/50 font-bold">Release Method</p>
                  <p className="mt-2 text-lg font-bold text-[var(--role-text)] capitalize">{selectedRequest.release_method.replace(/_/g, ' ')}</p>
                </div>
                <div className="panel-muted bg-white/40">
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--role-text)]/50 font-bold">Reference</p>
                  <p className="mt-2 text-lg font-bold text-[var(--role-text)]">{selectedRequest.release_reference_no || 'No reference'}</p>
                </div>
              </div>
            )}

            {selectedRequest.latest_liquidation && (
              <div className="panel-muted mt-4 bg-white/40">
                <p className="text-xs uppercase tracking-[0.16em] text-[var(--role-text)]/50 font-bold">Latest Liquidation</p>
                <p className="mt-2 text-lg font-bold capitalize text-[var(--role-text)]">{selectedRequest.latest_liquidation.status.replace(/_/g, ' ')}</p>
                <p className="mt-2 text-sm text-[var(--role-text)]/70">
                  Due: {selectedRequest.latest_liquidation.due_at ? new Date(selectedRequest.latest_liquidation.due_at).toLocaleString() : 'No due date'}
                </p>
                <p className="mt-1 text-sm text-[var(--role-text)]/70">
                  Actual amount: {selectedRequest.latest_liquidation.actual_amount ? formatMoney(toNumber(selectedRequest.latest_liquidation.actual_amount)) : 'Not submitted'}
                </p>
                {selectedRequest.latest_liquidation.remarks && (
                  <p className="mt-1 text-sm text-[var(--role-text)]/70 italic">"{selectedRequest.latest_liquidation.remarks}"</p>
                )}
              </div>
            )}

            <div className="panel-muted mt-4 bg-white/40">
              <p className="text-xs uppercase tracking-[0.16em] text-[var(--role-text)]/50 font-bold">Purpose</p>
              <p className="mt-2 text-[var(--role-text)]/90">{selectedRequest.purpose || 'No purpose provided.'}</p>
            </div>

            <div className="mt-6">
              <h3 className="text-xl font-bold text-[var(--role-text)]">Approval Flow</h3>
              <div className="mt-4 rounded-[24px] border border-[var(--role-border)] bg-[var(--role-accent)] p-4">
                <div className="mb-5 h-2 overflow-hidden rounded-full bg-[var(--role-border)]/20">
                  <div className="flex h-full w-full">
                    {selectedFlow.map((step) => (
                      <div
                        key={step.key}
                        className={`h-full flex-1 ${
                          step.state === 'current' ? 'bg-[var(--role-secondary)]' : step.state === 'done' ? 'bg-[var(--role-primary)]' : 'bg-[var(--role-border)]/40'
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
                          className={`mt-1.5 h-3 w-3 rounded-full ${
                            step.state === 'current' ? 'bg-[var(--role-secondary)]' : step.state === 'done' ? 'bg-[var(--role-primary)]' : 'bg-[var(--role-border)]'
                          }`}
                        />
                        {index !== selectedFlow.length - 1 && <div className="mt-2 h-full min-h-[28px] w-px bg-[var(--role-border)]" />}
                      </div>
                      <div className="panel-muted w-full bg-white/40">
                        <p className="font-bold text-[var(--role-text)]">{step.label}</p>
                        <p className="mt-1 text-sm text-[var(--role-text)]/70">{step.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {selectedRequest.rejection_reason && (
              <div className="panel-muted mt-6 border-red-500/20 bg-red-500/5">
                <p className="text-xs uppercase tracking-[0.16em] text-red-600 font-bold">Rejection Reason</p>
                <p className="mt-2 text-red-700 font-medium">{selectedRequest.rejection_reason}</p>
              </div>
            )}

            {selectedRequest.return_reason && (
              <div className="panel-muted mt-6 border-orange-500/20 bg-orange-500/5">
                <p className="text-xs uppercase tracking-[0.16em] text-orange-600 font-bold">Return Reason</p>
                <p className="mt-2 text-orange-700 font-medium">{selectedRequest.return_reason}</p>
                <p className="mt-2 text-xs text-orange-600/70">Revision count: {selectedRequest.revision_count || 0}</p>
                <button className="btn-primary mt-4 w-full" onClick={() => void resubmitRequest()}>
                  Resubmit Request
                </button>
              </div>
            )}

            {selectedRequest.status === 'released' && (
              <div className="panel-muted mt-6 bg-white/40">
                <p className="text-xs uppercase tracking-[0.16em] text-[var(--role-text)]/50 font-bold">Submit Liquidation</p>
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
                    <label className="text-xs uppercase tracking-[0.16em] text-[var(--role-text)]/50 font-bold">Attach Official Receipt / Image</label>
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
                        className="flex w-full cursor-pointer items-center justify-center gap-3 rounded-[22px] border border-dashed border-[var(--role-secondary)]/30 bg-[var(--role-accent)] py-6 transition hover:border-[var(--role-secondary)]/50 hover:bg-[var(--role-border)]/20"
                      >
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--role-secondary)]/10 text-[var(--role-secondary)]">
                          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                          </svg>
                        </div>
                        <span className="font-semibold text-[var(--role-text)]">
                          {liquidationDraft.file_url ? 'Change Image' : 'Click to Upload Receipt'}
                        </span>
                      </label>
                    </div>
                    {liquidationDraft.file_url && (
                      <div className="mt-2 overflow-hidden rounded-2xl border border-[var(--role-border)]/20">
                        <img 
                          src={liquidationDraft.file_url} 
                          alt="Liquidation attachment" 
                          className="h-auto max-h-[200px] w-full object-contain bg-[var(--role-border)]/10" 
                        />
                      </div>
                    )}
                  </div>

                  <button className="btn-primary w-full" onClick={() => void submitLiquidation()}>
                    Submit Liquidation
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {previewFile && (
        <FilePreviewer
          isOpen={!!previewFile}
          onClose={() => setPreviewFile(null)}
          fileUrl={previewFile.url}
          fileName={previewFile.name}
        />
      )}
    </div>
  );
};

export default RequestTracker;
