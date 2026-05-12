import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import FilePreviewer from '../components/FilePreviewer';
import { formatMoney, toNumber, getStatusLabel, getStatusColor, formatDateTime , getErrorMessage } from '../utils/format';
import jsPDF from 'jspdf';

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
  const navigate = useNavigate();
  const [requests, setRequests] = useState<any[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<any>(null);
  const [liquidationDraft, setLiquidationDraft] = useState({ 
    actual_amount: '', 
    remarks: '', 
    attachments: [] as { file_name: string, file_url: string }[] 
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'date' | 'amount'>('date');
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [previewFile, setPreviewFile] = useState<{ url: string; name: string } | null>(null);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 3;
  
  // Audit trail state
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditPage, setAuditPage] = useState(1);
  const auditPageSize = 3;

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
  
  // Pagination
  const paginatedRequests = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredRequests.slice(startIndex, startIndex + pageSize);
  }, [filteredRequests, currentPage]);
  
  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / pageSize));
  
  // Reset to first page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, dateStart, dateEnd]);

  // Fetch audit logs when selected request changes
  useEffect(() => {
    if (selectedRequest?.id) {
      void fetchAuditLogs(selectedRequest.id);
      setAuditPage(1); // Reset audit page
    } else {
      setAuditLogs([]);
    }
  }, [selectedRequest?.id]);

  const exportToCSV = () => {
    const headers = ['Expense No', 'Item Name', 'Category', 'Amount', 'Status', 'Submitted At', 'Priority', 'Attachment Count'];
    const rows = filteredRequests.map(req => [
      req.request_code,
      req.item_name,
      req.category,
      req.amount,
      req.status,
      formatDateTime(req.submitted_at),
      req.priority,
      Array.isArray(req.attachments) ? req.attachments.length : 0
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
      const res = await api.get('/api/requests/my', { headers: { Authorization: `Bearer ${token}` } });
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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const token = localStorage.getItem('token');
    const newAttachments = [...liquidationDraft.attachments];

    for (const file of Array.from(files)) {
      const formData = new FormData();
      formData.append('file', file);

      try {
        const loadingToast = toast.loading(`Uploading ${file.name}...`);
        const res = await api.post('/api/upload', formData, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        toast.dismiss(loadingToast);
        newAttachments.push({
          file_name: res.data.file_name,
          file_url: res.data.file_url
        });
        toast.success(`${file.name} uploaded!`);
      } catch (err: any) {
        console.error('Upload error details:', err);
        const errorMsg = err.response?.data?.error || err.message || 'Upload failed';
        toast.error(`Failed to upload ${file.name}: ${errorMsg}`);
      }
    }

    setLiquidationDraft(current => ({ ...current, attachments: newAttachments }));
  };

  const selectedFlow = useMemo(
    () => (selectedRequest ? buildFlow(selectedRequest.status) : []),
    [selectedRequest]
  );

  const submitLiquidation = async () => {
    if (!selectedRequest) return;
    if (!liquidationDraft.actual_amount || Number(liquidationDraft.actual_amount) <= 0) {
      return toast.error('Please enter a valid actual amount');
    }
    const token = localStorage.getItem('token');
    const loadingToast = toast.loading('Submitting liquidation...');
    try {
      await api.patch(
        `/api/requests/${selectedRequest.id}/liquidation`,
        {
          actual_amount: Number(liquidationDraft.actual_amount),
          remarks: liquidationDraft.remarks,
          attachments: liquidationDraft.attachments
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      toast.dismiss(loadingToast);
      toast.success('Liquidation submitted!');
      setLiquidationDraft({ actual_amount: '', remarks: '', attachments: [] });
      await fetchRequests(false);
    } catch (err: any) {
      toast.dismiss(loadingToast);
      toast.error(getErrorMessage(err, 'Liquidation failed'));
    }
  };

  const downloadVoucher = (req: any) => {
    try {
      const doc = new jsPDF();
      
      // Add Logo or Header
      doc.setFillColor(30, 43, 74);
      doc.rect(0, 0, 210, 40, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(22);
      doc.text('BUDGET REQUEST VOUCHER', 105, 25, { align: 'center' });
      
      // Add Content
      doc.setTextColor(20, 20, 20);
      doc.setFontSize(10);
      doc.text(`Voucher Date: ${new Date().toLocaleDateString()}`, 14, 50);
      doc.text(`Expense No: ${req.request_code}`, 14, 55);
      
      doc.setDrawColor(200, 200, 200);
      doc.line(14, 62, 196, 62);
      
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('REQUEST DETAILS', 14, 72);
      
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text('Item Name:', 14, 82);
      doc.text(req.item_name, 60, 82);
      
      doc.text('Category:', 14, 88);
      doc.text(req.category, 60, 88);
      
      doc.text('Amount:', 14, 94);
      doc.text(`PHP ${Number(req.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 60, 94);
      
      doc.text('Department:', 14, 100);
      doc.text(req.department_name || 'N/A', 60, 100);
      
      doc.text('Priority:', 14, 106);
      doc.text(req.priority.toUpperCase(), 60, 106);
      
      doc.text('Purpose:', 14, 112);
      const splitPurpose = doc.splitTextToSize(req.purpose || 'No purpose provided.', 130);
      doc.text(splitPurpose, 60, 112);
      
      // Approval Section
      const approvalY = 112 + (splitPurpose.length * 5) + 15;
      doc.setFont('helvetica', 'bold');
      doc.text('APPROVAL STATUS', 14, approvalY);
      
      doc.setFont('helvetica', 'normal');
      doc.text('Current Status:', 14, approvalY + 10);
      doc.setTextColor(16, 185, 129); // Emerald color
      doc.text(getStatusLabel(req.status).toUpperCase(), 60, approvalY + 10);
      
      doc.setTextColor(20, 20, 20);
      doc.text('Approval Date:', 14, approvalY + 16);
      doc.text(req.updated_at ? formatDateTime(req.updated_at) : 'N/A', 60, approvalY + 16);
      
      // Footer / Signatures
      doc.setDrawColor(200, 200, 200);
      doc.line(14, 250, 80, 250);
      doc.line(130, 250, 196, 250);
      doc.setFontSize(8);
      doc.text('Requested By', 47, 255, { align: 'center' });
      doc.text('Approved By (System Verified)', 163, 255, { align: 'center' });
      
      doc.setFontSize(7);
      doc.setTextColor(150, 150, 150);
      doc.text('This is a system-generated document. No signature required if status is APPROVED/DISBURSED.', 105, 285, { align: 'center' });
      
      doc.save(`Voucher_${req.request_code}.pdf`);
      toast.success('Voucher downloaded successfully!');
    } catch (err: any) {
      console.error('Voucher download error:', err);
      toast.error('Failed to generate voucher. Please try again.');
    }
  };

  // Fetch audit logs for selected request
  const fetchAuditLogs = async (requestId: string) => {
    setAuditLoading(true);
    const token = localStorage.getItem('token');
    try {
      const res = await api.get(`/api/requests/${requestId}/audit-logs`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAuditLogs(res.data || []);
    } catch (err: any) {
      toast.error('Failed to load audit trail');
      setAuditLogs([]);
    } finally {
      setAuditLoading(false);
    }
  };

  // Format audit action for display
  const formatAuditAction = (action: string) => {
    const labels: Record<string, string> = {
      'submitted': 'Submitted',
      'approved': 'Approved',
      'rejected': 'Rejected',
      'returned': 'Returned',
      'released': 'Fund Disbursed',
      'on_hold': 'On Hold',
      'off_hold': 'Resumed',
      'status_changed': 'Status Update',
      'liquidation_submitted': 'Liquidation Sent',
      'co_approved': 'Co-Approved',
      'archived': 'Archived',
      'unarchived': 'Unarchived'
    };
    return labels[action] || action;
  };

  const getAuditIcon = (action: string) => {
    switch (action) {
      case 'submitted':
        return (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        );
      case 'approved':
      case 'co_approved':
        return (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      case 'rejected':
      case 'returned':
        return (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        );
      case 'released':
        return (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case 'liquidation_submitted':
        return (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
        );
      default:
        return (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
    }
  };

  const paginatedAuditLogs = useMemo(() => {
    const start = (auditPage - 1) * auditPageSize;
    return auditLogs.slice(start, start + auditPageSize);
  }, [auditLogs, auditPage]);

  const totalAuditPages = Math.ceil(auditLogs.length / auditPageSize);

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
                placeholder="Search by item, expense no, category..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
            <select className="field-input w-auto" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="all">All Status</option>
              <option value="pending_supervisor">Pending Supervisor</option>
              <option value="pending_accounting">Pending Accounting</option>
              <option value="approved">Approved</option>
              <option value="released">Disbursed</option>
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
          {paginatedRequests.map((req) => (
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
                  {Array.isArray(req.attachments) && req.attachments.length > 0 && (
                    <p className="mt-1 text-xs uppercase tracking-[0.12em] text-[var(--role-text)]/50">
                      {req.attachments.length} supporting file{req.attachments.length > 1 ? 's' : ''}
                    </p>
                  )}
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
          
          {/* Pagination */}
          {filteredRequests.length > 0 && (
            <div className="flex items-center justify-between pt-4 border-t border-[var(--role-border)]">
              <p className="text-sm text-[var(--role-text)]/60">
                Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, filteredRequests.length)} of {filteredRequests.length} requests
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1.5 rounded-lg border border-[var(--role-border)] bg-[var(--role-accent)] text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--role-accent)]/80 transition"
                >
                  Previous
                </button>
                <span className="text-sm text-[var(--role-text)]/80 px-2">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1.5 rounded-lg border border-[var(--role-border)] bg-[var(--role-accent)] text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--role-accent)]/80 transition"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>

        {selectedRequest && (
          <div className="panel">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-2xl font-bold text-[var(--role-text)]">{selectedRequest.item_name}</h2>
                <p className="mt-2 text-[var(--role-text)]/70">{getStatusLabel(selectedRequest.status)}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className={`badge ${getStatusColor(selectedRequest.status)}`}>{getStatusLabel(selectedRequest.status)}</span>
                {(selectedRequest.status === 'approved' || selectedRequest.status === 'released') && (
                  <button 
                    onClick={() => downloadVoucher(selectedRequest)}
                    className="btn-primary !py-1.5 !px-3 text-xs flex items-center gap-2"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Download Voucher
                  </button>
                )}
              </div>
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
                  {['request', 'disbursement', 'liquidation'].map((scope) => {
                    const scoped = (selectedRequest.attachments || []).filter((attachment: any) => attachment.attachment_scope === scope);
                    if (scoped.length === 0) return null;

                    return (
                      <div key={scope} className="space-y-2">
                        <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--role-text)]/50">{scope} attachments</p>
                        {scoped.map((attachment: any) => (
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
                    );
                  })}
                </div>
              </div>
            )}

            {selectedRequest.release_method && (
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="panel-muted bg-white/40">
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--role-text)]/50 font-bold">Release Method</p>
                  <p className="mt-2 text-lg font-bold capitalize text-[var(--role-text)]">{selectedRequest.release_method.replace(/_/g, ' ')}</p>
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
                  Due: {selectedRequest.latest_liquidation.due_at ? formatDateTime(selectedRequest.latest_liquidation.due_at) : 'No due date'}
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

            {/* Audit Trail Section - Transparency */}
            <div className="mt-6">
              <h3 className="text-xl font-bold text-[var(--role-text)]">Audit Trail</h3>
              <p className="text-sm text-[var(--role-text)]/60 mt-1">
                Complete history of all actions with digital signatures
              </p>
              
              <div className="mt-4 rounded-[24px] border border-[var(--role-border)] bg-[var(--role-accent)] p-4">
                {auditLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin h-6 w-6 border-2 border-[var(--role-primary)] border-t-transparent rounded-full" />
                    <span className="ml-3 text-sm text-[var(--role-text)]/70">Loading audit trail...</span>
                  </div>
                ) : auditLogs.length === 0 ? (
                  <p className="text-center py-4 text-[var(--role-text)]/60">No audit records found</p>
                ) : (
                  <>
                    <div className="space-y-3">
                      {paginatedAuditLogs.map((log: any, index: number) => (
                        <div key={log.id || index} className="flex gap-4">
                          <div className="flex flex-col items-center">
                            <div className="mt-1.5 h-3 w-3 rounded-full bg-[var(--role-primary)]" />
                            {index !== paginatedAuditLogs.length - 1 && <div className="mt-2 h-full min-h-[28px] w-px bg-[var(--role-border)]" />}
                          </div>
                          <div className="panel-muted w-full bg-white/40">
                            <div className="flex justify-between items-start">
                              <div className="flex items-center gap-2 font-bold text-[var(--role-text)]">
                                <span className="text-[var(--role-primary)]">
                                  {getAuditIcon(log.action)}
                                </span>
                                {formatAuditAction(log.action)}
                              </div>
                              <span className="text-xs text-[var(--role-text)]/50">
                                {formatDateTime(log.created_at)}
                              </span>
                            </div>
                            <p className="mt-1 text-sm text-[var(--role-text)]/70">
                              By: <span className="font-medium">{log.user?.name || 'Unknown'}</span>
                              {log.user?.role && <span className="text-xs ml-2 px-2 py-0.5 rounded-full bg-[var(--role-border)]/30">{log.user.role}</span>}
                            </p>
                            {log.note && (
                              <p className="mt-2 text-sm text-[var(--role-text)]/80 italic">"{log.note}"</p>
                            )}
                            {log.old_value && log.new_value && (
                              <p className="mt-1 text-xs text-[var(--role-text)]/60">
                                {log.old_value} → {log.new_value}
                              </p>
                            )}
                            {log.digital_signature && (
                              <div className="mt-2 flex items-center gap-2 text-xs text-emerald-600">
                                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                                </svg>
                                <span className="font-mono">Digital Signature: {log.digital_signature.substring(0, 16)}...</span>
                              </div>
                            )}
                            <p className="mt-1 text-xs text-[var(--role-text)]/40">
                              IP: {log.ip_address} | Device: {log.device_fingerprint?.substring(0, 8) || 'Unknown'}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    {totalAuditPages > 1 && (
                      <div className="mt-4 flex items-center justify-between border-t border-[var(--role-border)]/20 pt-4">
                        <span className="text-xs text-[var(--role-text)]/50">
                          Page {auditPage} of {totalAuditPages}
                        </span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setAuditPage(p => Math.max(1, p - 1))}
                            disabled={auditPage === 1}
                            className="flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--role-border)] bg-white/50 text-xs font-bold disabled:opacity-30 hover:bg-white transition"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                            PREV
                          </button>
                          <button
                            onClick={() => setAuditPage(p => Math.min(totalAuditPages, p + 1))}
                            disabled={auditPage === totalAuditPages}
                            className="flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--role-border)] bg-white/50 text-xs font-bold disabled:opacity-30 hover:bg-white transition"
                          >
                            NEXT
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
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
                <button 
                  className="btn-primary mt-4 w-full bg-orange-600 border-orange-600 hover:bg-orange-700 flex items-center justify-center gap-2" 
                  onClick={() => navigate(`/request/edit/${selectedRequest.id}`)}
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Edit & Resubmit
                </button>
              </div>
            )}

            {selectedRequest.status === 'released' && selectedRequest.latest_liquidation?.status === 'submitted' && (
              <div className="panel-muted mt-6 border-blue-500/20 bg-blue-500/5">
                <p className="text-xs uppercase tracking-[0.16em] text-blue-600 font-bold">Liquidation Under Review</p>
                <p className="mt-2 text-sm text-blue-700">Your liquidation has been submitted and is being reviewed by accounting. Actual amount: <strong>{selectedRequest.latest_liquidation.actual_amount}</strong></p>
              </div>
            )}

            {selectedRequest.status === 'released' && selectedRequest.latest_liquidation?.status === 'verified' && (
              <div className="panel-muted mt-6 border-green-500/20 bg-green-500/5">
                <p className="text-xs uppercase tracking-[0.16em] text-green-600 font-bold">Liquidation Verified</p>
                <p className="mt-2 text-sm text-green-700">Your liquidation has been verified by accounting.</p>
                {selectedRequest.latest_liquidation.remarks && (
                  <p className="mt-1 text-xs text-green-600/70">Remarks: {selectedRequest.latest_liquidation.remarks}</p>
                )}
              </div>
            )}

            {selectedRequest.status === 'released' && selectedRequest.latest_liquidation?.status === 'returned' && (
              <div className="panel-muted mt-6 border-orange-500/20 bg-orange-500/5">
                <p className="text-xs uppercase tracking-[0.16em] text-orange-600 font-bold">Liquidation Returned for Correction</p>
                {selectedRequest.latest_liquidation.remarks && (
                  <p className="mt-2 text-sm text-orange-700">Remarks: {selectedRequest.latest_liquidation.remarks}</p>
                )}
              </div>
            )}

            {selectedRequest.status === 'released' && (!selectedRequest.latest_liquidation || selectedRequest.latest_liquidation.status === 'returned') && (
              <div className="panel-muted mt-6 bg-white/40">
                <p className="text-xs uppercase tracking-[0.16em] text-[var(--role-text)]/50 font-bold">
                  {selectedRequest.latest_liquidation?.status === 'returned' ? 'Resubmit Liquidation' : 'Submit Liquidation'}
                </p>
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
                    <label className="text-xs uppercase tracking-[0.16em] text-[var(--role-text)]/50 font-bold">Attach Official Receipt / Images</label>
                    
                    {/* Multi-attachment list */}
                    {liquidationDraft.attachments.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2">
                        {liquidationDraft.attachments.map((att, idx) => (
                          <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-[var(--role-accent)] border border-[var(--role-border)]">
                            <div className="flex items-center gap-2 overflow-hidden">
                              <svg className="w-5 h-5 text-[var(--role-primary)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                              <span className="text-xs truncate">{att.file_name}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                const newAtts = liquidationDraft.attachments.filter((_, i) => i !== idx);
                                setLiquidationDraft(prev => ({ ...prev, attachments: newAtts }));
                              }}
                              className="p-1 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="relative">
                      <input
                        type="file"
                        multiple
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
                          Click to Add Images / Receipts
                        </span>
                      </label>
                    </div>
                    
                    {liquidationDraft.attachments.length > 0 && (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {liquidationDraft.attachments.slice(0, 4).map((att, i) => (
                          <div key={i} className="aspect-video relative group overflow-hidden rounded-xl border border-[var(--role-border)]/20 bg-[var(--role-border)]/10">
                            <img 
                              src={att.file_url} 
                              alt="Preview" 
                              className="h-full w-full object-cover" 
                            />
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <button 
                                onClick={() => setPreviewFile({ url: att.file_url, name: att.file_name })}
                                className="text-white text-xs font-bold"
                              >
                                View
                              </button>
                            </div>
                          </div>
                        ))}
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
