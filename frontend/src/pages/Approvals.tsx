import { useEffect, useMemo, useState } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import Modal from '../components/Modal';
import { supabase } from '../lib/supabase';
import FilePreviewer from '../components/FilePreviewer';
import { buildCategorySearchString, getCategoryCode } from '../utils/categories';

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
    case 'on_hold':
      return 'On Hold';
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

// Format category with account codes for display
const formatCategoryWithCodes = (category: string): string => {
  if (!category) return '';
  const parts = category.split(' > ');
  const formattedParts = parts.map(part => {
    const code = getCategoryCode(part.trim());
    return code ? `${part} (${code})` : part;
  });
  return formattedParts.join(' > ');
};

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
  const [previewFile, setPreviewFile] = useState<{ url: string; name: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedRequests, setSelectedRequests] = useState<Set<string>>(new Set());
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

    // Supabase Realtime Subscription
    let channel: any;
    if (supabase) {
      channel = supabase
        .channel('approvals-changes')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'expense_requests' },
          () => {
            void fetchRequests(user.role);
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'approval_logs' },
          () => {
            void fetchRequests(user.role);
          }
        )
        .subscribe();
    }

    return () => {
      if (channel && supabase) {
        void supabase.removeChannel(channel);
      }
    };
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

  const filteredRequests = useMemo(() => {
    let result = requests;
    
    // Text search
    const query = searchQuery.toLowerCase().trim();
    if (query) {
      result = result.filter(req => {
        const categoryWithCodes = buildCategorySearchString(req.category || '').toLowerCase();
        return (
          String(req.item_name || '').toLowerCase().includes(query) ||
          String(req.request_code || '').toLowerCase().includes(query) ||
          String(req.category || '').toLowerCase().includes(query) ||
          categoryWithCodes.includes(query) ||
          String(getRequesterName(req)).toLowerCase().includes(query)
        );
      });
    }
    
    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter(req => req.status === statusFilter);
    }
    
    // Date range filter
    if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      result = result.filter(req => {
        const dateStr = req.submitted_at || req.created_at || req.updated_at;
        if (!dateStr) return false;
        const reqDate = new Date(dateStr);
        return reqDate >= start;
      });
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      result = result.filter(req => {
        const dateStr = req.submitted_at || req.created_at || req.updated_at;
        if (!dateStr) return false;
        const reqDate = new Date(dateStr);
        return reqDate <= end;
      });
    }
    
    return result;
  }, [requests, searchQuery, statusFilter, startDate, endDate]);

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
        // Validation check for petty cash before submitting
        const currentDraft = releaseDrafts[request.id];
        if (currentDraft?.release_method === 'petty_cash') {
          const balance = toNumber(request.budget_summary?.petty_cash_balance);
          if (balance < toNumber(request.amount)) {
            toast.error('Insufficient petty cash balance!');
            return;
          }
        }

        await saveAllocations(request.id, true);
        await api.patch(
          `/api/requests/${request.id}/release`,
          currentDraft || {},
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

  // Export filtered requests to CSV (Excel-compatible)
  const exportToExcel = () => {
    if (filteredRequests.length === 0) {
      toast.error('No data to export');
      return;
    }
    
    const headers = ['Request Code', 'Requester', 'Department', 'Category', 'Amount', 'Status', 'Submitted Date', 'Priority'];
    const rows = filteredRequests.map(req => [
      req.request_code,
      getRequesterName(req),
      req.department_name || req.departments?.name || '',
      req.category,
      req.amount,
      req.status,
      new Date(req.submitted_at || req.created_at).toLocaleDateString(),
      req.priority
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `requests_export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(`Exported ${filteredRequests.length} requests to Excel`);
  };

  // Bulk approve selected requests
  const handleBulkApprove = async () => {
    if (selectedRequests.size === 0) {
      toast.error('No requests selected');
      return;
    }
    
    const token = localStorage.getItem('token');
    let successCount = 0;
    let failCount = 0;
    
    const promises = Array.from(selectedRequests).map(async (requestId) => {
      try {
        await api.patch(`/api/requests/${requestId}/approve`, {}, { headers: { Authorization: `Bearer ${token}` } });
        successCount++;
      } catch {
        failCount++;
      }
    });
    
    await Promise.all(promises);
    
    if (successCount > 0) {
      toast.success(`Approved ${successCount} requests`);
    }
    if (failCount > 0) {
      toast.error(`Failed to approve ${failCount} requests`);
    }
    
    setSelectedRequests(new Set());
  };

  const selectAllVisible = () => {
    const visibleIds = filteredRequests.map(r => r.id);
    const allSelected = visibleIds.every(id => selectedRequests.has(id));
    
    if (allSelected) {
      // Deselect all visible
      setSelectedRequests(prev => {
        const newSet = new Set(prev);
        visibleIds.forEach(id => newSet.delete(id));
        return newSet;
      });
    } else {
      // Select all visible
      setSelectedRequests(prev => {
        const newSet = new Set(prev);
        visibleIds.forEach(id => newSet.add(id));
        return newSet;
      });
    }
  };

  const toggleRequestSelection = (id: string) => {
    setSelectedRequests(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleOnHold = async (requestId: string) => {
    const token = localStorage.getItem('token');
    try {
      const res = await api.patch(`/api/requests/${requestId}/hold`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const newStatus = res.data.status;
      toast.success(newStatus === 'on_hold' ? 'Request placed On Hold' : 'Request removed from On Hold');
      fetchRequests();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to toggle hold status');
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

  if (!user) return <div className="text-[var(--role-text)]">Loading...</div>;

  return (
    <div className="text-[var(--role-text)]">
      <div className="page-header">
        <h1 className="page-title">{user?.role === 'supervisor' ? 'Team Approvals' : 'Finance Review'}</h1>
        <p className="page-subtitle">
          {user?.role === 'supervisor' 
            ? 'Review and approve requests from your department.' 
            : 'Finalize fund releases and verify liquidation documents.'}
        </p>
      </div>

      {user?.role === 'accounting' && (
        <div className="mb-6 space-y-4">
          {/* View Toggle + Search */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-4">
              <button 
                onClick={() => setView('pending')} 
                className={`btn-secondary !rounded-full !px-6 ${view === 'pending' ? 'bg-[var(--role-accent)] border-[var(--role-border)]' : 'opacity-50'}`}
              >
                Pending Releases
              </button>
              <button 
                onClick={() => setView('liquidations')} 
                className={`btn-secondary !rounded-full !px-6 ${view === 'liquidations' ? 'bg-[var(--role-accent)] border-[var(--role-border)]' : 'opacity-50'}`}
              >
                Liquidation Review
              </button>
            </div>
            <div className="relative w-full sm:w-80">
              <input
                type="text"
                placeholder="Search by category, code, item..."
                className="field-input !pl-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <svg className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--role-text)]/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>
          
          {/* Filters Row */}
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--role-border)] bg-[var(--role-accent)]/50 p-3">
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--role-text)]/50">Filters:</span>
            
            {/* Status Filter */}
            <select
              className="field-input !py-1.5 !text-xs"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All Status</option>
              <option value="pending_supervisor">Pending Supervisor</option>
              <option value="pending_accounting">Pending Accounting</option>
              <option value="released">Released</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="returned_for_revision">Returned</option>
            </select>
            
            {/* Date Range */}
            <input
              type="date"
              className="field-input !py-1.5 !text-xs"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              placeholder="From"
            />
            <span className="text-[var(--role-text)]/40">-</span>
            <input
              type="date"
              className="field-input !py-1.5 !text-xs"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              placeholder="To"
            />
            
            {/* Clear Filters */}
            {(startDate || endDate || statusFilter !== 'all' || searchQuery) && (
              <button
                onClick={() => {
                  setStartDate('');
                  setEndDate('');
                  setStatusFilter('all');
                  setSearchQuery('');
                }}
                className="text-xs text-[var(--role-primary)] hover:underline"
              >
                Clear all
              </button>
            )}
            
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-[var(--role-text)]/60">
                {filteredRequests.length} result{filteredRequests.length !== 1 ? 's' : ''}
              </span>
              <button
                onClick={exportToExcel}
                className="btn-secondary !py-1.5 !px-3 !text-xs flex items-center gap-1"
                title="Export to Excel"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Export
              </button>
            </div>
          </div>
        </div>
      )}

      {user?.role === 'supervisor' && (
        <div className="mb-6 space-y-4">
          {/* Search */}
          <div className="flex justify-end">
            <div className="relative w-full sm:w-80">
              <input
                type="text"
                placeholder="Search by category, code, item..."
                className="field-input !pl-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <svg className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--role-text)]/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>
          
          {/* Filters Row */}
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--role-border)] bg-[var(--role-accent)]/50 p-3">
            {/* Select All Checkbox - only when there are pending requests */}
            {filteredRequests.some(r => r.status === 'pending_supervisor') && (
              <button
                onClick={selectAllVisible}
                className="flex items-center gap-2 text-xs font-medium text-[var(--role-text)] hover:text-[var(--role-primary)]"
              >
                <input
                  type="checkbox"
                  checked={filteredRequests.filter(r => r.status === 'pending_supervisor').every(r => selectedRequests.has(r.id))}
                  onChange={() => {}}
                  className="h-4 w-4 rounded border-[var(--role-border)] text-emerald-500"
                />
                Select All
              </button>
            )}
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--role-text)]/50">Filters:</span>
            
            {/* Status Filter */}
            <select
              className="field-input !py-1.5 !text-xs"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All Status</option>
              <option value="pending_supervisor">Pending My Review</option>
              <option value="pending_accounting">Pending Accounting</option>
              <option value="released">Released</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="returned_for_revision">Returned</option>
            </select>
            
            {/* Date Range */}
            <input
              type="date"
              className="field-input !py-1.5 !text-xs"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              placeholder="From"
            />
            <span className="text-[var(--role-text)]/40">-</span>
            <input
              type="date"
              className="field-input !py-1.5 !text-xs"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              placeholder="To"
            />
            
            {/* Clear Filters */}
            {(startDate || endDate || statusFilter !== 'all' || searchQuery) && (
              <button
                onClick={() => {
                  setStartDate('');
                  setEndDate('');
                  setStatusFilter('all');
                  setSearchQuery('');
                }}
                className="text-xs text-[var(--role-primary)] hover:underline"
              >
                Clear all
              </button>
            )}
            
            <div className="ml-auto flex items-center gap-2">
              {selectedRequests.size > 0 && (
                <button
                  onClick={handleBulkApprove}
                  className="btn-success !py-1.5 !px-3 !text-xs flex items-center gap-1"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Approve ({selectedRequests.size})
                </button>
              )}
              <span className="text-xs text-[var(--role-text)]/60">
                {filteredRequests.length} result{filteredRequests.length !== 1 ? 's' : ''}
              </span>
              <button
                onClick={exportToExcel}
                className="btn-secondary !py-1.5 !px-3 !text-xs flex items-center gap-1"
                title="Export to Excel"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Export
              </button>
            </div>
          </div>
        </div>
      )}

      {filteredRequests.length === 0 ? (
        <div className="panel text-center">
          <p className="text-xl font-semibold text-[var(--role-text)]">No pending approvals at this time.</p>
          <p className="mt-2 text-[var(--role-text)]/60">New requests will appear here automatically when they reach your stage.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredRequests.map((req) => {
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
                        {/* Checkbox for bulk approve - only for supervisor on pending requests */}
                        {user?.role === 'supervisor' && req.status === 'pending_supervisor' && (
                          <div 
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleRequestSelection(req.id);
                            }}
                            className="flex items-center"
                          >
                            <input
                              type="checkbox"
                              checked={selectedRequests.has(req.id)}
                              onChange={() => {}}
                              className="h-5 w-5 rounded border-[var(--role-border)] text-emerald-500 focus:ring-emerald-500 cursor-pointer"
                            />
                          </div>
                        )}
                        <h2 className="text-2xl font-bold text-[var(--role-text)]">{req.item_name}</h2>
                        <span className="rounded-full border border-[var(--role-border)] bg-[var(--role-accent)] px-3 py-1 text-sm font-medium text-[var(--role-text)]">
                          {getStatusLabel(req.status)}
                        </span>
                        {view === 'liquidations' && (
                          <span className="rounded-full border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-sm font-bold text-emerald-600">
                            Liquidation Submitted
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-lg text-[var(--role-text)]/90">{formatMoney(requestAmount)} • <span title={req.category}>{formatCategoryWithCodes(req.category)}</span></p>
                      <p className={`mt-3 max-w-2xl text-[var(--role-text)]/70 ${isExpanded ? '' : 'approval-card-description'}`}>{req.purpose}</p>
                      {isExpanded && req.metadata?.items && (
                        <div className="mt-4 space-y-2">
                          <p className="text-xs font-bold uppercase tracking-widest text-[var(--role-text)]/40">Item Breakdown</p>
                          <div className="overflow-hidden rounded-xl border border-[var(--role-border)]/10 bg-[var(--role-accent)]">
                            <table className="w-full text-left text-sm">
                              <thead className="border-b border-[var(--role-border)]/10 bg-[var(--role-border)]/5">
                                <tr>
                                  <th className="px-4 py-2 font-semibold">Date</th>
                                  <th className="px-4 py-2 font-semibold">Payee</th>
                                  <th className="px-4 py-2 font-semibold">Type</th>
                                  <th className="px-4 py-2 text-right font-semibold">Amount</th>
                                </tr>
                              </thead>
                              <tbody>
                                {req.metadata.items.map((item: any, idx: number) => (
                                  <tr key={idx} className="border-b border-[var(--role-border)]/5 last:border-0">
                                    <td className="px-4 py-2">{item.expense_date}</td>
                                    <td className="px-4 py-2">{item.payee_name}</td>
                                    <td className="px-4 py-2">{item.expense_type}</td>
                                    <td className="px-4 py-2 text-right font-medium">{formatMoney(item.amount)}</td>
                                  </tr>
                                ))}
                                <tr className="bg-[var(--role-border)]/5 font-bold">
                                  <td colSpan={3} className="px-4 py-2 text-right">Total</td>
                                  <td className="px-4 py-2 text-right">{formatMoney(req.amount)}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="space-y-2 text-sm text-[var(--role-text)]/60 lg:text-right">
                      <p>Priority: <span className="font-semibold capitalize text-[var(--role-text)]">{req.priority}</span></p>
                      <p>Submitted: <span className="font-semibold text-[var(--role-text)]">{new Date(req.submitted_at).toLocaleString()}</span></p>
                      <span className="inline-flex rounded-full border border-[var(--role-border)] bg-[var(--role-accent)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--role-text)]">
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
                            <h3 className="text-sm font-bold uppercase tracking-widest text-emerald-600">Liquidation Details</h3>
                            <div className="mt-4 space-y-3">
                              <div className="flex justify-between">
                                <span className="text-[var(--role-text)]/60">Actual Amount:</span>
                                <span className="font-bold text-[var(--role-text)]">{formatMoney(toNumber(req.latest_liquidation.actual_amount))}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-[var(--role-text)]/60">Difference:</span>
                                <span className={`font-bold ${toNumber(req.latest_liquidation.actual_amount) > toNumber(req.amount) ? 'text-orange-600' : 'text-emerald-600'}`}>
                                  {formatMoney(toNumber(req.latest_liquidation.actual_amount) - toNumber(req.amount))}
                                </span>
                              </div>
                              <div className="pt-2">
                                <p className="text-xs uppercase tracking-wider text-[var(--role-text)]/50">Remarks:</p>
                                <p className="mt-1 text-sm italic text-[var(--role-text)]">"{req.latest_liquidation.remarks || 'No remarks provided'}"</p>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div>
                          <p className="mb-2 text-xs uppercase tracking-[0.16em] text-[var(--role-text)]/50">Receipt / Attachment</p>
                          {req.attachments?.filter((a: any) => a.attachment_scope === 'liquidation').map((attachment: any) => (
                            <div key={attachment.id} className="group relative overflow-hidden rounded-2xl border border-[var(--role-border)] bg-[var(--role-accent)]">
                              <img 
                                src={attachment.file_url} 
                                alt="Receipt" 
                                className="h-auto max-h-[300px] w-full object-contain transition group-hover:scale-105"
                              />
                              <button 
                                type="button"
                                onClick={() => setPreviewFile({ url: attachment.file_url, name: attachment.file_name || 'Receipt' })}
                                className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100"
                              >
                                <span className="btn-secondary">Preview Image</span>
                              </button>
                            </div>
                          )) || (
                            <div className="flex h-[200px] items-center justify-center rounded-2xl border border-dashed border-[var(--role-border)] bg-[var(--role-accent)]">
                              <p className="text-[var(--role-text)]/40">No receipt attached</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="mb-5 mt-5">
                      {req.attachments && req.attachments.length > 0 && (
                        <div className="mb-6">
                          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-[var(--role-text)]/40">Supporting Documents</p>
                          <div className="flex flex-wrap gap-4">
                            {req.attachments.map((attachment: any) => (
                              <div key={attachment.id} className="group relative h-24 w-24 overflow-hidden rounded-xl border border-[var(--role-border)]/10 bg-[var(--role-accent)] transition hover:border-[var(--role-secondary)]/30">
                                {attachment.attachment_type?.startsWith('image/') ? (
                                  <img 
                                    src={attachment.file_url} 
                                    alt={attachment.file_name} 
                                    className="h-full w-full object-cover transition group-hover:scale-110"
                                  />
                                ) : (
                                  <div className="flex h-full w-full flex-col items-center justify-center p-2 text-center">
                                    <svg className="h-8 w-8 text-[var(--role-text)]/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                    </svg>
                                    <span className="mt-1 block truncate text-[10px] text-[var(--role-text)]/60">{attachment.file_name}</span>
                                  </div>
                                )}
                                <button 
                                  onClick={() => setPreviewFile({ url: attachment.file_url, name: attachment.file_name })}
                                  className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100"
                                >
                                  <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                  </svg>
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <p className="text-sm text-[var(--role-secondary)]">
                        Requested by <span className="font-semibold text-[var(--role-text)]">{getRequesterName(req)}</span>
                      </p>
                      <p className="mt-1 text-sm text-[var(--role-text)]/70">
                        Requesting Department: <span className="font-semibold text-[var(--role-text)]">{req.department_name || 'Unknown department'}</span>
                      </p>
                    </div>

                    {user.role === 'supervisor' && (
                      <div className="mb-5 rounded-[24px] border border-[var(--role-border)] bg-[var(--role-accent)] p-4">
                        <h3 className="text-lg font-semibold text-[var(--role-text)]">Urgency Control</h3>
                        <p className="mt-1 text-sm text-[var(--role-text)]/60">Supervisors can raise or lower the urgency before approval.</p>
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
                      <div className="mb-5 rounded-[24px] border border-[var(--role-border)] bg-[var(--role-accent)] p-4">
                        <button
                          type="button"
                          onClick={() => toggleSplitPanel(req.id)}
                          className="flex w-full flex-col gap-3 rounded-[20px] border border-[var(--role-border)] bg-[var(--role-surface)] px-4 py-4 text-left transition hover:border-[var(--role-secondary)]/30 hover:bg-[var(--role-accent)] sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div>
                            <h3 className="text-lg font-semibold text-[var(--role-text)]">Department Allocation Split</h3>
                            <p className="mt-1 text-sm text-[var(--role-text)]/60">
                              Click to {isSplitExpanded ? 'hide' : 'manage'} the department split before release.
                            </p>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-sm text-[var(--role-text)]/70">
                              Total allocated: <span className="font-semibold text-[var(--role-text)]">{formatMoney(draftTotal)}</span> / {formatMoney(requestAmount)}
                            </div>
                            <span className="rounded-full border border-[var(--role-border)] bg-[var(--role-accent)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--role-text)]">
                              {isSplitExpanded ? 'Hide' : 'Open'}
                            </span>
                          </div>
                        </button>

                        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                          <div className="panel-muted !p-4">
                            <p className="text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/50">Requesting Dept Total Budget</p>
                            <p className="mt-2 text-lg font-semibold text-[var(--role-text)]">{formatMoney(requestingDepartmentBudget)}</p>
                            <p className="mt-1 text-xs text-[var(--role-text)]/60">{req.department_name || 'Unknown department'} total annual budget</p>
                          </div>
                          <div className="panel-muted !p-4">
                            <p className="text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/50">Preview Total Budget</p>
                            <p className="mt-2 text-lg font-semibold text-[var(--role-text)]">{formatMoney(requestAmount)}</p>
                            <p className="mt-1 text-xs text-[var(--role-text)]/60">Full request amount before approval</p>
                          </div>
                          <div className="panel-muted !p-4">
                            <p className="text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/50">Allocated Draft</p>
                            <p className="mt-2 text-lg font-semibold text-[var(--role-text)]">{formatMoney(draftTotal)}</p>
                            <p className="mt-1 text-xs text-[var(--role-text)]/60">Current split total from accounting</p>
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                          <div className="panel-muted !p-4">
                            <p className="text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/50">Dept Remaining After Approval</p>
                            <p className="mt-2 text-lg font-semibold text-[var(--role-text)]">{formatMoney(projectedRemainingAfterApproval)}</p>
                            <p className="mt-1 text-xs text-[var(--role-text)]/60">
                              Current remaining {formatMoney(requestingDepartmentRemaining)} before approval
                            </p>
                          </div>
                          <div className="panel-muted !p-4">
                            <p className="text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/50">Balance to Allocate</p>
                            <p className="mt-2 text-lg font-semibold text-[var(--role-text)]">{formatMoney(remainingToAllocate)}</p>
                            <p className="mt-1 text-xs text-[var(--role-text)]/60">Should be zero before final approval</p>
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
                      <div className="mb-5 rounded-[24px] border border-[var(--role-border)] bg-[var(--role-accent)] p-4">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-semibold text-[var(--role-text)]">Release Details</h3>
                          {releaseDrafts[req.id]?.release_method === 'petty_cash' && (
                            <div className={`px-4 py-1.5 rounded-2xl border ${toNumber(budgetSummary?.petty_cash_balance) < requestAmount ? 'bg-red-500/10 border-red-500/30 text-red-600' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600'} flex items-center gap-2 animate-in fade-in duration-300`}>
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                              </svg>
                              <span className="text-xs font-bold uppercase tracking-widest">
                                Petty Cash: {formatMoney(toNumber(budgetSummary?.petty_cash_balance))}
                              </span>
                            </div>
                          )}
                        </div>
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
                          {releaseDrafts[req.id]?.release_method !== 'cash' && (
                            <input
                              className="field-input"
                              placeholder="Reference number"
                              value={releaseDrafts[req.id]?.release_reference_no || ''}
                              onChange={(event) => updateReleaseDraft(req.id, 'release_reference_no', event.target.value)}
                            />
                          )}
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
                        {releaseDrafts[req.id]?.release_method === 'petty_cash' && toNumber(budgetSummary?.petty_cash_balance) < requestAmount && (
                          <p className="mt-3 text-[10px] text-red-500 font-bold uppercase tracking-tighter flex items-center gap-1 animate-pulse">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            Warning: Request amount exceeds current Petty Cash balance.
                          </p>
                        )}
                      </div>
                    )}

                    <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                      {(req.allocations || []).map((allocation: any) => (
                        <div key={`${req.id}-${allocation.department_id}`} className="panel-muted !p-4">
                          <p className="text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/50">{allocation.department_name}</p>
                          <p className="mt-2 text-lg font-semibold text-[var(--role-text)]">{formatMoney(toNumber(allocation.amount))}</p>
                          <p className="mt-1 text-xs text-[var(--role-text)]/60">
                            Remaining {formatMoney(toNumber(allocation.remaining_budget))}
                          </p>
                          <p className="mt-1 text-xs text-[var(--role-text)]/60">
                            Projected {formatMoney(toNumber(allocation.projected_remaining_budget))}
                          </p>
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <button 
                        onClick={() => void handleApprove(req)} 
                        className="btn-success"
                        disabled={req.status === 'on_hold'}
                        title={req.status === 'on_hold' ? 'Cannot release - request is On Hold' : ''}
                      >
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
                      {user.role === 'accounting' && (
                        <button
                          onClick={() => toggleOnHold(req.id)}
                          className={`px-4 py-2 rounded-2xl text-sm font-semibold transition ${
                            req.status === 'on_hold'
                              ? 'bg-amber-100 text-amber-700 border border-amber-300 hover:bg-amber-200'
                              : 'bg-gray-100 text-gray-600 border border-gray-300 hover:bg-amber-50'
                          }`}
                          title={req.status === 'on_hold' ? 'Remove from On Hold' : 'Place On Hold'}
                        >
                          {req.status === 'on_hold' ? (
                            <span className="flex items-center gap-2">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              On Hold
                            </span>
                          ) : (
                            <span className="flex items-center gap-2">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              Hold
                            </span>
                          )}
                        </button>
                      )}
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

export default Approvals;
