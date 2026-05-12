import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api';
import toast from 'react-hot-toast';
import { formatDateTime, formatActionLabel , getErrorMessage } from '../utils/format';

interface AuditLog {
  id: string;
  request_id: string;
  request_code?: string;
  item_name?: string;
  request_status?: string;
  action: string;
  actor_name: string;
  actor_role: string;
  stage?: string;
  note?: string;
  entity_type?: string;
  old_value?: string;
  new_value?: string;
  created_at: string;
}

interface RequestInfo {
  id: string;
  request_code: string;
  item_name: string;
  status: string;
  employee_name: string;
  department_name: string;
}

const AuditTrail = () => {
  const navigate = useNavigate();
  const { requestId } = useParams();
  
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [requestInfo, setRequestInfo] = useState<RequestInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const logsPerPage = 5;

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/login');
      return;
    }

    const loadAuditTrail = async () => {
      try {
        if (requestId) {
          // Load specific request audit trail
          const [requestRes, logsRes] = await Promise.all([
            api.get(`/api/requests/${requestId}`, { headers: { Authorization: `Bearer ${token}` } }),
            api.get(`/api/requests/${requestId}/timeline`, { headers: { Authorization: `Bearer ${token}` } })
          ]);
          
          const request = requestRes.data;
          setRequestInfo({
            id: request.id,
            request_code: request.request_code,
            item_name: request.item_name,
            status: request.status,
            employee_name: request.requester_name || request.users?.name || 'Unknown',
            department_name: request.department_name || request.departments?.name || 'Unknown'
          });
          
          setLogs(logsRes.data || []);
        } else {
          // Load recent audit logs (finance/admin only)
          const res = await api.get('/api/requests/audit-logs', {
            headers: { Authorization: `Bearer ${token}` }
          });
          setLogs(res.data || []);
        }
      } catch (err: any) {
        toast.error(getErrorMessage(err, 'Failed to load audit trail'));
      } finally {
        setLoading(false);
      }
    };

    loadAuditTrail();
  }, [navigate, requestId]);

  const getActionIcon = (action: string) => {
    switch (action.toLowerCase()) {
      case 'submitted':
        return (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case 'approved':
      case 'co_approved':
      case 'force_approved':
      case 'liquidation_approved':
        return (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      case 'rejected':
      case 'liquidation_rejected':
        return (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        );
      case 'returned':
      case 'returned_for_revision':
        return (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
          </svg>
        );
      case 'released':
        return (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case 'user_updated':
        return (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        );
      case 'budget_category_created':
      case 'budget_category_updated':
      case 'budget_category_deleted':
        return (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        );
      default:
        return (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
    }
  };

  const getActionColor = (action: string) => {
    switch (action.toLowerCase()) {
      case 'submitted':
        return 'bg-[var(--role-primary)]/20 text-[var(--role-secondary)] border-[var(--role-primary)]/30';
      case 'approved':
      case 'co_approved':
      case 'force_approved':
      case 'liquidation_approved':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      case 'rejected':
      case 'liquidation_rejected':
        return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'returned':
      case 'returned_for_revision':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      case 'released':
        return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
      case 'user_updated':
        return 'bg-sky-500/20 text-sky-400 border-sky-500/30';
      case 'budget_category_created':
        return 'bg-teal-500/20 text-teal-400 border-teal-500/30';
      case 'budget_category_updated':
        return 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30';
      case 'budget_category_deleted':
        return 'bg-rose-500/20 text-rose-400 border-rose-500/30';
      default:
        return 'bg-[var(--role-accent)] text-[var(--role-text)]/70 border-[var(--role-border)]';
    }
  };

  const filteredLogs = logs.filter(log => {
    const matchesAction = actionFilter === 'all' || log.action.toLowerCase() === actionFilter;
    const searchLower = searchQuery.toLowerCase();
    const matchesSearch = 
      (log.request_code?.toLowerCase() || '').includes(searchLower) ||
      (log.item_name?.toLowerCase() || '').includes(searchLower) ||
      (log.actor_name?.toLowerCase() || '').includes(searchLower) ||
      (log.action?.toLowerCase() || '').includes(searchLower) ||
      (log.note?.toLowerCase() || '').includes(searchLower);
    
    return matchesAction && matchesSearch;
  });

  const totalPages = Math.ceil(filteredLogs.length / logsPerPage);
  const currentLogs = filteredLogs.slice(
    (currentPage - 1) * logsPerPage,
    currentPage * logsPerPage
  );

  // Reset to first page when filtering or searching
  useEffect(() => {
    setCurrentPage(1);
  }, [actionFilter, searchQuery]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="bms-spinner"></div>
      </div>
    );
  }

  return (
    <div className="text-[var(--role-text)] page-transition">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Audit Trail</h1>
        <p className="page-subtitle">
          {requestInfo 
            ? `Complete history for ${requestInfo.request_code}` 
            : 'Recent system activity and request history'}
        </p>
      </div>

      {/* Request Info Card (if viewing specific request) */}
      {requestInfo && (
        <div className="panel mb-6">
          <div className="flex flex-wrap items-start gap-4">
            <div className="flex-1">
              <p className="text-sm text-[var(--role-text)]/60 mb-1">Request Code</p>
              <p className="text-xl font-bold">{requestInfo.request_code}</p>
            </div>
            <div className="flex-1">
              <p className="text-sm text-[var(--role-text)]/60 mb-1">Item</p>
              <p className="font-medium">{requestInfo.item_name}</p>
            </div>
            <div className="flex-1">
              <p className="text-sm text-[var(--role-text)]/60 mb-1">Employee</p>
              <p className="font-medium">{requestInfo.employee_name}</p>
            </div>
            <div className="flex-1">
              <p className="text-sm text-[var(--role-text)]/60 mb-1">Department</p>
              <p className="font-medium">{requestInfo.department_name}</p>
            </div>
            <div className="flex-1">
              <p className="text-sm text-[var(--role-text)]/60 mb-1">Status</p>
              <span className="inline-flex px-3 py-1 rounded-full text-sm font-medium bg-[var(--role-accent)] border border-[var(--role-border)]">
                {requestInfo.status.replace(/_/g, ' ')}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Action Filter */}
      <div className="panel mb-6">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-[var(--role-text)]/60 mb-1">Action Type</label>
            <select
              className="field-input"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
            >
              <option value="all">All Actions</option>
              <option value="submitted">Submitted</option>
              <option value="approved">Approved</option>
              <option value="co_approved">Co-Approved</option>
              <option value="force_approved">Force Approved</option>
              <option value="released">Released</option>
              <option value="rejected">Rejected</option>
              <option value="returned">Returned</option>
              <option value="returned_for_revision">Returned for Revision</option>
              <option value="liquidation_approved">Liquidation Approved</option>
              <option value="liquidation_rejected">Liquidation Rejected</option>
              <option value="user_updated">User Updated</option>
              <option value="budget_category_created">Budget Category Created</option>
              <option value="budget_category_updated">Budget Category Updated</option>
              <option value="budget_category_deleted">Budget Category Deleted</option>
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-[var(--role-text)]/60 mb-1">Search Logs</label>
            <div className="relative">
              <input
                type="text"
                placeholder="Search by code, item, actor..."
                className="field-input pl-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-[var(--role-text)]/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>
          <p className="text-sm text-[var(--role-text)]/60 self-center mt-6">
            Showing {filteredLogs.length} of {logs.length} entries
          </p>
        </div>
      </div>

      {/* Audit Timeline */}
      <div className="panel">
        <h2 className="text-lg font-semibold mb-6 flex items-center gap-2">
          <svg className="w-5 h-5 text-[var(--role-primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Activity Timeline
        </h2>

        {currentLogs.length === 0 ? (
          <div className="text-center py-8 text-[var(--role-text)]/60">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p>No audit records found</p>
          </div>
        ) : (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-[var(--role-border)]"></div>

            <div className="space-y-6">
              {currentLogs.map((log, index) => (
                <div key={log.id || index} className="relative flex gap-4">
                  {/* Icon */}
                  <div className={`relative z-10 w-12 h-12 rounded-full flex items-center justify-center border-2 ${getActionColor(log.action)}`}>
                    {getActionIcon(log.action)}
                  </div>

                  {/* Content */}
                  <div className="flex-1 pt-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      {log.request_code && (
                        <span className="font-bold text-[var(--role-primary)] text-sm">
                          {log.request_code}
                        </span>
                      )}
                      <span className="font-semibold">{formatActionLabel(log.action)}</span>
                      {log.item_name && (
                        <span className="text-sm text-[var(--role-text)]/70 italic">
                          • {log.item_name}
                        </span>
                      )}
                      {log.stage && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--role-accent)] text-[var(--role-text)]/70">
                          {log.stage}
                        </span>
                      )}
                      {log.entity_type && log.entity_type !== 'system' && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--role-secondary)]/10 text-[var(--role-secondary)]">
                          {log.entity_type.replace(/_/g, ' ')}
                        </span>
                      )}
                      <span className="text-sm text-[var(--role-text)]/60 ml-auto">
                        {formatDateTime(log.created_at || (log as any).event_time)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-sm text-[var(--role-text)]/70 mb-2">
                      <span className="font-medium text-[var(--role-text)]">{log.actor_name}</span>
                      <span>({log.actor_role})</span>
                    </div>

                    {log.note && (
                      <div className="p-3 rounded-xl bg-[var(--role-accent)]/50 border border-[var(--role-border)] text-sm">
                        {log.note}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-4">
          <button
            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
            disabled={currentPage === 1}
            className="p-2 rounded-xl border border-[var(--role-border)] bg-[var(--role-accent)] disabled:opacity-30 disabled:cursor-not-allowed transition hover:bg-[var(--role-primary)]/10"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          
          <div className="flex items-center gap-2">
            {(() => {
              const pages: (number | string)[] = [];
              if (totalPages <= 7) {
                for (let i = 1; i <= totalPages; i++) pages.push(i);
              } else {
                pages.push(1);
                if (currentPage > 3) pages.push('...');
                for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
                  pages.push(i);
                }
                if (currentPage < totalPages - 2) pages.push('...');
                pages.push(totalPages);
              }
              return pages.map((page, idx) =>
                page === '...' ? (
                  <span key={`ellipsis-${idx}`} className="px-1 text-[var(--role-text)]/40 font-bold">…</span>
                ) : (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page as number)}
                    className={`h-9 w-9 rounded-xl text-sm font-bold transition ${currentPage === page ? 'bg-[var(--role-primary)] text-[var(--role-text-inverse)] shadow-lg shadow-[var(--role-primary)]/30' : 'border border-[var(--role-border)] bg-[var(--role-accent)] hover:bg-[var(--role-primary)]/10'}`}
                  >
                    {page}
                  </button>
                )
              );
            })()}
          </div>

          <button
            onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
            disabled={currentPage === totalPages}
            className="p-2 rounded-xl border border-[var(--role-border)] bg-[var(--role-accent)] disabled:opacity-30 disabled:cursor-not-allowed transition hover:bg-[var(--role-primary)]/10"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      )}

      {/* Export Button */}
      <div className="mt-6 flex justify-end">
        <button
          onClick={() => {
            // Export functionality
            const csvContent = [
              ['Date', 'Request Code', 'Item Name', 'Action', 'Actor', 'Role', 'Stage', 'Details/Note', 'Old Value', 'New Value'].join(','),
              ...filteredLogs.map(log => [
                formatDateTime(log.created_at || (log as any).event_time),
                log.request_code || '',
                `"${(log.item_name || '').replace(/"/g, '""')}"`,
                log.action,
                log.actor_name,
                log.actor_role,
                log.stage || '',
                `"${(log.note || (log as any).details || '').replace(/"/g, '""')}"`,
                `"${(log.old_value || '').replace(/"/g, '""')}"`,
                `"${(log.new_value || '').replace(/"/g, '""')}"`
              ].join(','))
            ].join('\n');
            
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `system-logs-${new Date().toISOString().split('T')[0]}.csv`;
            a.click();
            window.URL.revokeObjectURL(url);
            toast.success('System logs exported successfully!');
          }}
          className="btn-secondary flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Export CSV
        </button>
      </div>
    </div>
  );
};

export default AuditTrail;
