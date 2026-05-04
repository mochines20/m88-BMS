import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api';
import toast from 'react-hot-toast';
import { formatDateTime } from '../utils/format';

interface AuditLog {
  id: string;
  request_id: string;
  action: string;
  actor_name: string;
  actor_role: string;
  stage?: string;
  note?: string;
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
        toast.error(err.response?.data?.error || 'Failed to load audit trail');
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
        return (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      case 'rejected':
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
        return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'approved':
        return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'rejected':
        return 'bg-red-100 text-red-700 border-red-200';
      case 'returned':
      case 'returned_for_revision':
        return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'released':
        return 'bg-purple-100 text-purple-700 border-purple-200';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

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

      {/* Audit Timeline */}
      <div className="panel">
        <h2 className="text-lg font-semibold mb-6 flex items-center gap-2">
          <svg className="w-5 h-5 text-[var(--role-primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Activity Timeline
        </h2>

        {logs.length === 0 ? (
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
              {logs.map((log, index) => (
                <div key={log.id || index} className="relative flex gap-4">
                  {/* Icon */}
                  <div className={`relative z-10 w-12 h-12 rounded-full flex items-center justify-center border-2 ${getActionColor(log.action)}`}>
                    {getActionIcon(log.action)}
                  </div>

                  {/* Content */}
                  <div className="flex-1 pt-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="font-semibold">{log.action.replace(/_/g, ' ').toUpperCase()}</span>
                      {log.stage && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--role-accent)] text-[var(--role-text)]/70">
                          {log.stage}
                        </span>
                      )}
                      <span className="text-sm text-[var(--role-text)]/60 ml-auto">
                        {formatDateTime(log.created_at)}
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

      {/* Export Button */}
      <div className="mt-6 flex justify-end">
        <button
          onClick={() => {
            // Export functionality
            const csvContent = [
              ['Date', 'Action', 'Actor', 'Role', 'Stage', 'Note'].join(','),
              ...logs.map(log => [
                log.created_at,
                log.action,
                log.actor_name,
                log.actor_role,
                log.stage || '',
                `"${(log.note || '').replace(/"/g, '""')}"`
              ].join(','))
            ].join('\n');
            
            const blob = new Blob([csvContent], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `audit-trail-${requestInfo?.request_code || 'all'}-${new Date().toISOString().split('T')[0]}.csv`;
            a.click();
            window.URL.revokeObjectURL(url);
            toast.success('Audit trail exported!');
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
