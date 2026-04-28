import { useEffect, useMemo, useState } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import Modal from '../components/Modal';

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

const getRequesterName = (req: any) =>
  req.requester_name || req.users?.name || req.user?.name || req.employee_name || req.requested_by || 'Unknown requester';

const Approvals = () => {
  const [requests, setRequests] = useState<any[]>([]);
  const [user, setUser] = useState<any>(null);
  const [view, setView] = useState<'pending' | 'liquidations'>('pending');
  const [departments, setDepartments] = useState<any[]>([]);
  const [allocationDrafts, setAllocationDrafts] = useState<Record<string, Array<{ department_id: string; amount: string }>>>({});
  const [priorityDrafts, setPriorityDrafts] = useState<Record<string, string>>({});
  const [releaseDrafts, setReleaseDrafts] = useState<Record<string, { release_method: string; release_reference_no: string; release_note: string; liquidation_due_at: string }>>({});
  const [expandedRequests, setExpandedRequests] = useState<Record<string, boolean>>({});
  const [expandedSplits, setExpandedSplits] = useState<Record<string, boolean>>({});
  const [savingRequestId, setSavingRequestId] = useState('');
  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean;
    requestId: string;
    type: 'return' | 'reject';
    title: string;
    message: string;
    placeholder: string;
    confirmLabel: string;
  }>({
    isOpen: false,
    requestId: '',
    type: 'return',
    title: '',
    message: '',
    placeholder: '',
    confirmLabel: ''
  });

  useEffect(() => {
    const token = localStorage.getItem('token');
    api.get('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        setUser(res.data);
        fetchRequests(res.data.role);
        if (res.data.role === 'accounting' || res.data.role === 'admin') {
          fetchDepartments();
        }
      })
      .catch(() => toast.error('Failed to load approval data'));
  }, []);

  useEffect(() => {
    if (!user?.role) return;

    const intervalId = window.setInterval(() => {
      fetchRequests(user.role);
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [user?.role, view]);

  const fetchDepartments = async () => {
    const token = localStorage.getItem('token');
    try {
      const res = await api.get('/api/departments', { headers: { Authorization: `Bearer ${token}` } });
      setDepartments(res.data);
    } catch {
      toast.error('Failed to fetch departments');
    }
  };

  const fetchRequests = async (role = user?.role) => {
    const token = localStorage.getItem('token');
    try {
      const res = await api.get('/api/requests', { headers: { Authorization: `Bearer ${token}` } });
      
      // Filter based on view
      const filtered = res.data.filter((request: any) => {
        if (view === 'pending') {
          return (role === 'supervisor' && request.status === 'pending_supervisor') ||
                 (role === 'accounting' && request.status === 'pending_accounting');
        } else {
          return request.latest_liquidation?.status === 'submitted';
        }
      });

      setRequests(filtered);
      setAllocationDrafts((current) => {
        const next = { ...current };
        filtered.forEach((request: any) => {
          if (!next[request.id]) {
            next[request.id] = (request.allocations || []).map((allocation: any) => ({
              department_id: allocation.department_id,
              amount: String(toNumber(allocation.amount))
            }));
          }
        });
        return next;
      });
      setPriorityDrafts((current) => {
        const next = { ...current };
        filtered.forEach((request: any) => {
          if (!next[request.id]) {
            next[request.id] = request.priority || 'normal';
          }
        });
        return next;
      });
      setReleaseDrafts((current) => {
        const next = { ...current };
        filtered.forEach((request: any) => {
          if (!next[request.id]) {
            next[request.id] = {
              release_method: request.release_method || 'bank_transfer',
              release_reference_no: request.release_reference_no || '',
              release_note: request.release_note || '',
              liquidation_due_at: request.latest_liquidation?.due_at ? String(request.latest_liquidation.due_at).slice(0, 10) : ''
            };
          }
        });
        return next;
      });
    } catch {
      toast.error('Failed to fetch requests');
    }
  };

  const handleLiquidationReview = async (requestId: string, status: 'verified' | 'returned') => {
    const token = localStorage.getItem('token');
    try {
      await api.patch(`/api/requests/${requestId}/liquidation/review`, { status }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(`Liquidation ${status === 'verified' ? 'verified' : 'returned'}!`);
      await fetchRequests();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Review failed');
    }
  };

  const handleApprove = async (request: any) => {
    if (view === 'liquidations') {
      await handleLiquidationReview(request.id, 'verified');
      return;
    }

    const token = localStorage.getItem('token');
    try {
      if (user?.role === 'accounting') {
        await saveAllocations(request.id, true);
        await api.patch(
          `/api/requests/${request.id}/release`,
          releaseDrafts[request.id] || {},
          { headers: { Authorization: `Bearer ${token}` } }
        );
        toast.success('Request released!');
        fetchRequests();
        fetchDepartments();
        return;
      }

      await api.patch(`/api/requests/${request.id}/approve`, {}, { headers: { Authorization: `Bearer ${token}` } });
      toast.success('Request approved!');
      fetchRequests();
      fetchDepartments();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Approval failed');
    }
  };

  const handleReject = async (id: string, reason: string) => {
    const token = localStorage.getItem('token');
    try {
      await api.patch(`/api/requests/${id}/reject`, { reason }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success('Request rejected!');
      fetchRequests();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Rejection failed');
    }
  };

  const handleReturn = async (requestId: string, reason: string) => {
    if (view === 'liquidations') {
      await handleLiquidationReview(requestId, 'returned');
      return;
    }

    const token = localStorage.getItem('token');
    const normalizedReason = String(reason || '').trim();
    if (!normalizedReason) {
      toast.error('Return reason is required');
      return;
    }

    try {
      await api.patch(`/api/requests/${requestId}/return`, { reason: normalizedReason }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success('Request returned for revision!');
      fetchRequests();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Return failed');
    }
  };

  const updateReleaseDraft = (requestId: string, field: 'release_method' | 'release_reference_no' | 'release_note' | 'liquidation_due_at', value: string) => {
    setReleaseDrafts((current) => ({
      ...current,
      [requestId]: {
        release_method: current[requestId]?.release_method || 'bank_transfer',
        release_reference_no: current[requestId]?.release_reference_no || '',
        release_note: current[requestId]?.release_note || '',
        liquidation_due_at: current[requestId]?.liquidation_due_at || '',
        [field]: value
      }
    }));
  };

  const updateAllocationRow = (requestId: string, index: number, field: 'department_id' | 'amount', value: string) => {
    setAllocationDrafts((current) => ({
      ...current,
      [requestId]: (current[requestId] || []).map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row))
    }));
  };

  const addAllocationRow = (requestId: string, fallbackDepartmentId: string) => {
    setAllocationDrafts((current) => ({
      ...current,
      [requestId]: [...(current[requestId] || []), { department_id: fallbackDepartmentId, amount: '0' }]
    }));
  };

  const removeAllocationRow = (requestId: string, index: number) => {
    setAllocationDrafts((current) => ({
      ...current,
      [requestId]: (current[requestId] || []).filter((_, rowIndex) => rowIndex !== index)
    }));
  };

  const getDraftTotal = (requestId: string) =>
    (allocationDrafts[requestId] || []).reduce((sum, row) => sum + toNumber(row.amount), 0);

  const toggleSplitPanel = (requestId: string) => {
    setExpandedSplits((current) => ({
      ...current,
      [requestId]: !current[requestId]
    }));
  };

  const toggleRequestPanel = (requestId: string) => {
    setExpandedRequests((current) => {
      const isOpening = !current[requestId];
      return isOpening ? { [requestId]: true } : {};
    });
  };

  const savePriority = async (requestId: string) => {
    const token = localStorage.getItem('token');
    const priority = priorityDrafts[requestId] || 'normal';

    try {
      const res = await api.patch(
        `/api/requests/${requestId}/priority`,
        { priority },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setPriorityDrafts((current) => ({
        ...current,
        [requestId]: res.data?.priority || priority
      }));
      toast.success('Urgency updated.');
      await fetchRequests();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to update urgency');
    }
  };

  const saveAllocations = async (requestId: string, silent = false) => {
    const token = localStorage.getItem('token');
    const draft = allocationDrafts[requestId] || [];
    setSavingRequestId(requestId);
    try {
      const res = await api.patch(
        `/api/requests/${requestId}/allocations`,
        {
          allocations: draft.map((row) => ({
            department_id: row.department_id,
            amount: toNumber(row.amount)
          }))
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setAllocationDrafts((current) => ({
        ...current,
        [requestId]: (res.data || []).map((allocation: any) => ({
          department_id: allocation.department_id,
          amount: String(toNumber(allocation.amount))
        }))
      }));

      if (!silent) {
        toast.success('Department split saved.');
      }
      await fetchRequests();
      await fetchDepartments();
    } finally {
      setSavingRequestId('');
    }
  };

  const departmentOptions = useMemo(
    () =>
      departments.map((department) => ({
        id: department.id,
        label: `${department.name} • Remaining ${formatMoney(toNumber(department.remaining_budget))} • Projected ${formatMoney(toNumber(department.projected_remaining_budget))}`
      })),
    [departments]
  );

  if (!user) return <div className="text-white">Loading...</div>;

  return (
    <div className="text-white">
      <div className="page-header">
        <h1 className="page-title">{user?.role === 'supervisor' ? 'Team Approvals' : 'Finance Review'}</h1>
        <p className="page-subtitle">
          {user?.role === 'supervisor' 
            ? 'Review and approve requests from your department.' 
            : 'Finalize fund releases and verify liquidation documents.'}
        </p>
      </div>

      {user?.role === 'accounting' && (
        <div className="mb-6 flex gap-4">
          <button 
            onClick={() => setView('pending')} 
            className={`btn-secondary !rounded-full !px-6 ${view === 'pending' ? 'bg-white/10 border-white/20' : 'opacity-50'}`}
          >
            Pending Releases
          </button>
          <button 
            onClick={() => setView('liquidations')} 
            className={`btn-secondary !rounded-full !px-6 ${view === 'liquidations' ? 'bg-white/10 border-white/20' : 'opacity-50'}`}
          >
            Liquidation Review
          </button>
        </div>
      )}

      {requests.length === 0 ? (
        <div className="panel text-center">
          <p className="text-xl font-semibold text-white">No pending approvals at this time.</p>
          <p className="mt-2 text-[#D9E1F1]/78">New requests will appear here automatically when they reach your stage.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {requests.map((req) => {
            const draftRows = allocationDrafts[req.id] || [];
            const draftTotal = getDraftTotal(req.id);
            const requestAmount = toNumber(req.amount);
            const remainingToAllocate = requestAmount - draftTotal;
            const isExpanded = Boolean(expandedRequests[req.id]);
            const isSplitExpanded = Boolean(expandedSplits[req.id]);
            const budgetSummary = req.budget_summary;
            const requestingDepartmentBudget = toNumber(budgetSummary?.annual_budget);
            const requestingDepartmentRemaining = toNumber(budgetSummary?.remaining_budget);
            const projectedRemainingAfterApproval = toNumber(budgetSummary?.projected_remaining_after_approval);

            return (
              <div key={req.id} className={`panel approval-card ${isExpanded ? 'approval-card-open' : 'approval-card-closed'}`}>
                <button type="button" onClick={() => toggleRequestPanel(req.id)} className="w-full text-left">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-3">
                        <h2 className="text-2xl font-bold text-white">{req.item_name}</h2>
                        <span className="rounded-full border border-[#8FB3E2]/16 bg-[#31487A]/22 px-3 py-1 text-sm font-medium text-white">
                          {getStatusLabel(req.status)}
                        </span>
                        {view === 'liquidations' && (
                          <span className="rounded-full border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-sm font-bold text-emerald-400">
                            Liquidation Submitted
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-lg text-[#D9E1F1]">{formatMoney(requestAmount)} • {req.category}</p>
                      <p className={`mt-3 max-w-2xl text-[#D9E1F1]/80 ${isExpanded ? '' : 'approval-card-description'}`}>{req.purpose}</p>
                    </div>
                    <div className="space-y-2 text-sm text-[#D9E1F1]/78 lg:text-right">
                      <p>Priority: <span className="font-semibold capitalize text-white">{req.priority}</span></p>
                      <p>Submitted: <span className="font-semibold text-white">{new Date(req.submitted_at).toLocaleDateString()}</span></p>
                      <span className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-white">
                        {isExpanded ? 'Collapse' : 'Expand'}
                      </span>
                    </div>
                  </div>
                </button>

                <div className={`approval-card-details ${isExpanded ? 'approval-card-details-open' : 'approval-card-details-closed'}`}>
                  <div className="pt-5">
                    {view === 'liquidations' && req.latest_liquidation && (
                      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
                        <div className="space-y-4">
                          <div className="panel-muted !border-emerald-500/10 !bg-emerald-500/5">
                            <h3 className="text-sm font-bold uppercase tracking-widest text-emerald-400">Liquidation Details</h3>
                            <div className="mt-4 space-y-3">
                              <div className="flex justify-between">
                                <span className="text-[#D9E1F1]/60">Actual Amount:</span>
                                <span className="font-bold text-white">{formatMoney(toNumber(req.latest_liquidation.actual_amount))}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-[#D9E1F1]/60">Difference:</span>
                                <span className={`font-bold ${toNumber(req.latest_liquidation.actual_amount) > toNumber(req.amount) ? 'text-orange-400' : 'text-emerald-400'}`}>
                                  {formatMoney(toNumber(req.latest_liquidation.actual_amount) - toNumber(req.amount))}
                                </span>
                              </div>
                              <div className="pt-2">
                                <p className="text-xs uppercase tracking-wider text-[#D9E1F1]/50">Remarks:</p>
                                <p className="mt-1 text-sm italic text-white">"{req.latest_liquidation.remarks || 'No remarks provided'}"</p>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div>
                          <p className="mb-2 text-xs uppercase tracking-[0.16em] text-[#D9E1F1]/56">Receipt / Attachment</p>
                          {req.attachments?.filter((a: any) => a.attachment_scope === 'liquidation').map((attachment: any) => (
                            <div key={attachment.id} className="group relative overflow-hidden rounded-2xl border border-[#8FB3E2]/20 bg-black/20">
                              <img 
                                src={attachment.file_url} 
                                alt="Receipt" 
                                className="h-auto max-h-[300px] w-full object-contain transition group-hover:scale-105"
                              />
                              <a 
                                href={attachment.file_url} 
                                target="_blank" 
                                rel="noreferrer"
                                className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100"
                              >
                                <span className="btn-secondary">View Full Image</span>
                              </a>
                            </div>
                          )) || (
                            <div className="flex h-[200px] items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/10">
                              <p className="text-[#D9E1F1]/40">No receipt attached</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="mb-5 mt-5">
                      <p className="text-sm text-[#8FB3E2]/90">
                        Requested by <span className="font-semibold text-white">{getRequesterName(req)}</span>
                      </p>
                      <p className="mt-1 text-sm text-[#D9E1F1]/76">
                        Requesting Department: <span className="font-semibold text-white">{req.department_name || 'Unknown department'}</span>
                      </p>
                    </div>

                    {user.role === 'supervisor' && (
                      <div className="mb-5 rounded-[24px] border border-[#8FB3E2]/10 bg-black/10 p-4">
                        <h3 className="text-lg font-semibold text-white">Urgency Control</h3>
                        <p className="mt-1 text-sm text-[#D9E1F1]/68">Supervisors can raise or lower the urgency before approval.</p>
                        <div className="mt-4 flex flex-wrap items-center gap-3">
                          <select
                            className="field-input max-w-[220px]"
                            value={priorityDrafts[req.id] || req.priority || 'normal'}
                            onChange={(event) => setPriorityDrafts((current) => ({
                              ...current,
                              [req.id]: event.target.value
                            }))}
                          >
                            <option value="low">Low</option>
                            <option value="normal">Normal</option>
                            <option value="urgent">Urgent</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => void savePriority(req.id)}
                            className="btn-secondary"
                          >
                            Update Urgency
                          </button>
                        </div>
                      </div>
                    )}

                    {user.role === 'accounting' && (
                      <div className="mb-5 rounded-[24px] border border-[#8FB3E2]/10 bg-black/10 p-4">
                        <button
                          type="button"
                          onClick={() => toggleSplitPanel(req.id)}
                          className="flex w-full flex-col gap-3 rounded-[20px] border border-[#8FB3E2]/12 bg-[#31487A]/12 px-4 py-4 text-left transition hover:border-[#8FB3E2]/26 hover:bg-[#31487A]/18 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div>
                            <h3 className="text-lg font-semibold text-white">Department Allocation Split</h3>
                            <p className="mt-1 text-sm text-[#D9E1F1]/68">
                              Click to {isSplitExpanded ? 'hide' : 'manage'} the department split before release.
                            </p>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-sm text-[#D9E1F1]/72">
                              Total allocated: <span className="font-semibold text-white">{formatMoney(draftTotal)}</span> / {formatMoney(requestAmount)}
                            </div>
                            <span className="rounded-full border border-[#8FB3E2]/16 bg-black/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-white">
                              {isSplitExpanded ? 'Hide' : 'Open'}
                            </span>
                          </div>
                        </button>

                        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                          <div className="panel-muted !p-4">
                            <p className="text-xs uppercase tracking-[0.14em] text-[#D9E1F1]/56">Requesting Dept Total Budget</p>
                            <p className="mt-2 text-lg font-semibold text-white">{formatMoney(requestingDepartmentBudget)}</p>
                            <p className="mt-1 text-xs text-[#D9E1F1]/62">{req.department_name || 'Unknown department'} total annual budget</p>
                          </div>
                          <div className="panel-muted !p-4">
                            <p className="text-xs uppercase tracking-[0.14em] text-[#D9E1F1]/56">Preview Total Budget</p>
                            <p className="mt-2 text-lg font-semibold text-white">{formatMoney(requestAmount)}</p>
                            <p className="mt-1 text-xs text-[#D9E1F1]/62">Full request amount before approval</p>
                          </div>
                          <div className="panel-muted !p-4">
                            <p className="text-xs uppercase tracking-[0.14em] text-[#D9E1F1]/56">Allocated Draft</p>
                            <p className="mt-2 text-lg font-semibold text-white">{formatMoney(draftTotal)}</p>
                            <p className="mt-1 text-xs text-[#D9E1F1]/62">Current split total from accounting</p>
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                          <div className="panel-muted !p-4">
                            <p className="text-xs uppercase tracking-[0.14em] text-[#D9E1F1]/56">Dept Remaining After Approval</p>
                            <p className="mt-2 text-lg font-semibold text-white">{formatMoney(projectedRemainingAfterApproval)}</p>
                            <p className="mt-1 text-xs text-[#D9E1F1]/62">
                              Current remaining {formatMoney(requestingDepartmentRemaining)} before approval
                            </p>
                          </div>
                          <div className="panel-muted !p-4">
                            <p className="text-xs uppercase tracking-[0.14em] text-[#D9E1F1]/56">Balance to Allocate</p>
                            <p className="mt-2 text-lg font-semibold text-white">{formatMoney(remainingToAllocate)}</p>
                            <p className="mt-1 text-xs text-[#D9E1F1]/62">Should be zero before final approval</p>
                          </div>
                        </div>

                        {isSplitExpanded && (
                          <>
                            <div className="mt-4 space-y-3">
                              {draftRows.map((row, index) => (
                                <div key={`${req.id}-${index}`} className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_180px_120px]">
                                  <select
                                    value={row.department_id}
                                    onChange={(event) => updateAllocationRow(req.id, index, 'department_id', event.target.value)}
                                    className="field-input"
                                  >
                                    {departmentOptions.map((option) => (
                                      <option key={option.id} value={option.id}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={row.amount}
                                    onChange={(event) => updateAllocationRow(req.id, index, 'amount', event.target.value)}
                                    className="field-input"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => removeAllocationRow(req.id, index)}
                                    className="btn-danger"
                                    disabled={draftRows.length <= 1}
                                  >
                                    Remove
                                  </button>
                                </div>
                              ))}
                            </div>

                            <div className="mt-4 flex flex-wrap gap-3">
                              <button
                                type="button"
                                onClick={() => addAllocationRow(req.id, req.department_id)}
                                className="btn-secondary"
                              >
                                Add Department Split
                              </button>
                              <button
                                type="button"
                                onClick={() => void saveAllocations(req.id)}
                                className="btn-primary"
                                disabled={savingRequestId === req.id}
                              >
                                {savingRequestId === req.id ? 'Saving...' : 'Save Allocation'}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {user.role === 'accounting' && (
                      <div className="mb-5 rounded-[24px] border border-[#8FB3E2]/10 bg-black/10 p-4">
                        <h3 className="text-lg font-semibold text-white">Release Details</h3>
                        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                          <select
                            className="field-input"
                            value={releaseDrafts[req.id]?.release_method || 'bank_transfer'}
                            onChange={(event) => updateReleaseDraft(req.id, 'release_method', event.target.value)}
                          >
                            <option value="bank_transfer">Bank Transfer</option>
                            <option value="cash">Cash</option>
                            <option value="check">Check</option>
                            <option value="petty_cash">Petty Cash</option>
                            <option value="other">Other</option>
                          </select>
                          <input
                            className="field-input"
                            placeholder="Reference number"
                            value={releaseDrafts[req.id]?.release_reference_no || ''}
                            onChange={(event) => updateReleaseDraft(req.id, 'release_reference_no', event.target.value)}
                          />
                          <input
                            className="field-input"
                            type="date"
                            value={releaseDrafts[req.id]?.liquidation_due_at || ''}
                            onChange={(event) => updateReleaseDraft(req.id, 'liquidation_due_at', event.target.value)}
                          />
                          <input
                            className="field-input"
                            placeholder="Release note"
                            value={releaseDrafts[req.id]?.release_note || ''}
                            onChange={(event) => updateReleaseDraft(req.id, 'release_note', event.target.value)}
                          />
                        </div>
                      </div>
                    )}

                    <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                      {(req.allocations || []).map((allocation: any) => (
                        <div key={`${req.id}-${allocation.department_id}`} className="panel-muted !p-4">
                          <p className="text-xs uppercase tracking-[0.14em] text-[#D9E1F1]/56">{allocation.department_name}</p>
                          <p className="mt-2 text-lg font-semibold text-white">{formatMoney(toNumber(allocation.amount))}</p>
                          <p className="mt-1 text-xs text-[#D9E1F1]/62">
                            Remaining {formatMoney(toNumber(allocation.remaining_budget))}
                          </p>
                          <p className="mt-1 text-xs text-[#D9E1F1]/62">
                            Projected {formatMoney(toNumber(allocation.projected_remaining_budget))}
                          </p>
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <button onClick={() => void handleApprove(req)} className="btn-success">
                        {user.role === 'accounting' ? 'Release' : 'Approve'}
                      </button>
                      <button
                        onClick={() => {
                          setModalConfig({
                            isOpen: true,
                            requestId: req.id,
                            type: 'reject',
                            title: 'Reject Request',
                            message: 'Provide a reason for rejecting this request. This will be visible to the requester.',
                            placeholder: 'Enter rejection reason...',
                            confirmLabel: 'Reject Request'
                          });
                        }}
                        className="btn-danger"
                      >
                        Reject
                      </button>
                      <button
                        onClick={() => {
                          setModalConfig({
                            isOpen: true,
                            requestId: req.id,
                            type: 'return',
                            title: 'Return for Revision',
                            message: 'Explain what needs to be corrected before this request can move forward.',
                            placeholder: 'Enter the revision details or reason for return...',
                            confirmLabel: 'Send Back'
                          });
                        }}
                        className="btn-secondary"
                      >
                        Return for Revision
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        isOpen={modalConfig.isOpen}
        onClose={() => setModalConfig(prev => ({ ...prev, isOpen: false }))}
        onConfirm={(value) => {
          if (modalConfig.type === 'reject') {
            void handleReject(modalConfig.requestId, value);
          } else {
            void handleReturn(modalConfig.requestId, value);
          }
          setModalConfig(prev => ({ ...prev, isOpen: false }));
        }}
        title={modalConfig.title}
        message={modalConfig.message}
        placeholder={modalConfig.placeholder}
        confirmLabel={modalConfig.confirmLabel}
        cancelLabel="Cancel"
        type="prompt"
      />
    </div>
  );
};

export default Approvals;
