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

const getRequesterName = (req: any) =>
  req.requester_name || req.users?.name || req.user?.name || req.employee_name || req.requested_by || 'Unknown requester';

const Approvals = () => {
  const [requests, setRequests] = useState<any[]>([]);
  const [user, setUser] = useState<any>(null);
  const [departments, setDepartments] = useState<any[]>([]);
  const [allocationDrafts, setAllocationDrafts] = useState<Record<string, Array<{ department_id: string; amount: string }>>>({});
  const [releaseDrafts, setReleaseDrafts] = useState<Record<string, { release_method: string; release_reference_no: string; release_note: string; liquidation_due_at: string }>>({});
  const [expandedRequests, setExpandedRequests] = useState<Record<string, boolean>>({});
  const [expandedSplits, setExpandedSplits] = useState<Record<string, boolean>>({});
  const [savingRequestId, setSavingRequestId] = useState('');

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
  }, [user?.role]);

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
      const pending = res.data.filter((request: any) =>
        (role === 'supervisor' && request.status === 'pending_supervisor') ||
        (role === 'accounting' && request.status === 'pending_accounting')
      );
      setRequests(pending);
      setAllocationDrafts((current) => {
        const next = { ...current };
        pending.forEach((request: any) => {
          if (!next[request.id]) {
            next[request.id] = (request.allocations || []).map((allocation: any) => ({
              department_id: allocation.department_id,
              amount: String(toNumber(allocation.amount))
            }));
          }
        });
        return next;
      });
      setReleaseDrafts((current) => {
        const next = { ...current };
        pending.forEach((request: any) => {
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

  const handleApprove = async (request: any) => {
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

  const handleReturn = async (requestId: string) => {
    const token = localStorage.getItem('token');
    const reason = prompt('Return reason:');
    if (!reason) return;

    try {
      await api.patch(`/api/requests/${requestId}/return`, { reason }, { headers: { Authorization: `Bearer ${token}` } });
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

  const departmentOptionsWithFiscalYear = departmentOptions.map((option) => {
    const department = departments.find((entry) => entry.id === option.id);
    return {
      ...option,
      label: `${department?.name || 'Department'} • FY ${department?.fiscal_year || 'N/A'} • ${String(option.label || '').split(' • ').slice(1).join(' • ')}`
    };
  });

  if (!user) return <div className="text-white">Loading...</div>;

  return (
    <div className="text-white">
      <div className="page-header">
        <h1 className="page-title">Pending Approvals</h1>
        <p className="page-subtitle">Review incoming requests with department ownership, projected deductions, and split allocations before you approve.</p>
      </div>

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
                    <div className="mb-5 mt-5">
                      <p className="text-sm text-[#8FB3E2]/90">
                        Requested by <span className="font-semibold text-white">{getRequesterName(req)}</span>
                      </p>
                      <p className="mt-1 text-sm text-[#D9E1F1]/76">
                        Requesting Department: <span className="font-semibold text-white">{req.department_name || 'Unknown department'}</span>
                      </p>
                    </div>

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
                          const reason = prompt('Rejection reason:');
                          if (reason) handleReject(req.id, reason);
                        }}
                        className="btn-danger"
                      >
                        Reject
                      </button>
                      <button onClick={() => void handleReturn(req.id)} className="btn-secondary">
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
    </div>
  );
};

export default Approvals;
