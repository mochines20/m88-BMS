import { useEffect, useMemo, useState } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import { formatMoney, formatDateTime, toNumber } from '../utils/format';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

interface PettyCashAlert {
  department_id: string;
  department_name: string;
  current_balance: number;
  threshold: number;
  alert_type: 'low' | 'critical';
}

interface ReconciliationItem {
  id: string;
  request_code: string;
  amount: number;
  status: string;
  released_at: string;
  release_method: string;
  release_reference_no: string;
  reconciled: boolean;
  discrepancy_note?: string;
}

interface AuditLog {
  id: string;
  action: string;
  actor_name: string;
  actor_role: string;
  created_at: string;
  details?: string;
  request_code?: string;
}

const AccountingDashboard = () => {
  const [user, setUser] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'petty_cash' | 'releases' | 'reconciliation' | 'audit'>('overview');
  
  // Overview data
  const [departments, setDepartments] = useState<any[]>([]);
  const [pendingReleases, setPendingReleases] = useState<any[]>([]);
  const [recentReleases, setRecentReleases] = useState<any[]>([]);
  const [stats, setStats] = useState({
    total_pending: 0,
    total_released_today: 0,
    total_released_this_month: 0,
    petty_cash_alerts: 0,
    on_hold_count: 0
  });

  // Petty Cash data
  const [pettyCashAlerts, setPettyCashAlerts] = useState<PettyCashAlert[]>([]);
  const [pettyCashThreshold, setPettyCashThreshold] = useState(5000);
  const [selectedDeptForPetty, setSelectedDeptForPetty] = useState('');
  const [pettyCashHistory, setPettyCashHistory] = useState<any[]>([]);

  // Release Tracking
  const [selectedRequests, setSelectedRequests] = useState<Set<string>>(new Set());
  const [releaseFilter, setReleaseFilter] = useState({
    status: 'pending_accounting',
    date_from: '',
    date_to: ''
  });

  // Reconciliation
  const [reconciliationItems, setReconciliationItems] = useState<ReconciliationItem[]>([]);
  const [reconciliationFilter, setReconciliationFilter] = useState('all');

  // Audit Trail
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditFilter, setAuditFilter] = useState({
    action: 'all',
    date_from: '',
    date_to: ''
  });

  // Loading states
  const [loading, setLoading] = useState(true);
  const [isBatchReleasing, setIsBatchReleasing] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    const fetchUser = async () => {
      try {
        const res = await api.get('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` }
        });
        setUser(res.data);
      } catch {
        toast.error('Failed to load user data');
      }
    };

    fetchUser();
    loadAllData();
  }, []);

  const loadAllData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        fetchDepartments(),
        fetchPendingReleases(),
        fetchRecentReleases(),
        fetchStats(),
        checkPettyCashAlerts(),
        fetchReconciliationItems(),
        fetchAuditLogs()
      ]);
    } catch (err) {
      toast.error('Failed to load accounting data');
    } finally {
      setLoading(false);
    }
  };

  const fetchDepartments = async () => {
    const res = await api.get('/api/auth/signup-departments');
    setDepartments(res.data || []);
  };

  const fetchPendingReleases = async () => {
    const token = localStorage.getItem('token');
    // Fetch all requests that accounting needs to handle (both pending and on_hold)
    const res = await api.get('/api/requests', {
      headers: { Authorization: `Bearer ${token}` }
    });
    // Filter to only show pending_accounting and on_hold statuses
    const filtered = (res.data || []).filter((r: any) => 
      r.status === 'pending_accounting' || r.status === 'on_hold'
    );
    setPendingReleases(filtered);
  };

  const fetchRecentReleases = async () => {
    const token = localStorage.getItem('token');
    const today = new Date().toISOString().slice(0, 10);
    const res = await api.get(`/api/requests?status=released&date_from=${today}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    setRecentReleases(res.data || []);
  };

  const fetchStats = async () => {
    // Calculate stats from available data
    const today = new Date().toISOString().slice(0, 10);
    const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    
    setStats({
      total_pending: pendingReleases.length,
      total_released_today: recentReleases.filter(r => r.released_at?.startsWith(today)).length,
      total_released_this_month: recentReleases.filter(r => r.released_at >= firstDayOfMonth).length,
      petty_cash_alerts: pettyCashAlerts.length,
      on_hold_count: pendingReleases.filter(r => r.status === 'on_hold').length
    });
  };

  const checkPettyCashAlerts = async () => {
    const alerts: PettyCashAlert[] = [];
    departments.forEach(dept => {
      const balance = toNumber(dept.petty_cash_balance);
      if (balance < pettyCashThreshold * 0.2) {
        alerts.push({
          department_id: dept.id,
          department_name: dept.name,
          current_balance: balance,
          threshold: pettyCashThreshold,
          alert_type: 'critical'
        });
      } else if (balance < pettyCashThreshold * 0.5) {
        alerts.push({
          department_id: dept.id,
          department_name: dept.name,
          current_balance: balance,
          threshold: pettyCashThreshold,
          alert_type: 'low'
        });
      }
    });
    setPettyCashAlerts(alerts);
  };

  const fetchPettyCashHistory = async (deptId: string) => {
    if (!deptId) return;
    const token = localStorage.getItem('token');
    try {
      const res = await api.get(`/api/petty-cash/${deptId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setPettyCashHistory(res.data || []);
    } catch {
      toast.error('Failed to load petty cash history');
    }
  };

  const fetchReconciliationItems = async () => {
    const token = localStorage.getItem('token');
    const res = await api.get('/api/requests?status=released', {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    const items: ReconciliationItem[] = (res.data || []).map((req: any) => ({
      id: req.id,
      request_code: req.request_code,
      amount: toNumber(req.amount),
      status: req.status,
      released_at: req.released_at,
      release_method: req.release_method,
      release_reference_no: req.release_reference_no,
      reconciled: req.reconciled || false,
      discrepancy_note: req.discrepancy_note
    }));
    
    setReconciliationItems(items);
  };

  const fetchAuditLogs = async () => {
    const token = localStorage.getItem('token');
    try {
      const res = await api.get('/api/audit-logs', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAuditLogs(res.data || []);
    } catch {
      // Audit logs endpoint might not exist yet
      setAuditLogs([]);
    }
  };

  const handleBatchRelease = async () => {
    if (selectedRequests.size === 0) {
      toast.error('Select at least one request to release');
      return;
    }

    // Filter out on-hold requests (check actual request status)
    const selectedArray = Array.from(selectedRequests);
    const onHoldCount = selectedArray.filter(id => pendingReleases.find(r => r.id === id)?.status === 'on_hold').length;
    const eligibleRequests = selectedArray.filter(id => pendingReleases.find(r => r.id === id)?.status !== 'on_hold');
    
    if (eligibleRequests.length === 0) {
      toast.error('Selected requests are On Hold and cannot be released');
      return;
    }
    
    if (onHoldCount > 0) {
      toast(`${onHoldCount} on-hold request(s) will be skipped`);
    }

    setIsBatchReleasing(true);
    const token = localStorage.getItem('token');
    const requestsToRelease = eligibleRequests;
    
    try {
      for (const requestId of requestsToRelease) {
        await api.patch(
          `/api/requests/${requestId}/release`,
          { release_method: 'bank_transfer', release_reference_no: `BATCH-${Date.now()}` },
          { headers: { Authorization: `Bearer ${token}` } }
        );
      }
      
      toast.success(`Released ${requestsToRelease.length} requests successfully!`);
      setSelectedRequests(new Set());
      loadAllData();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to batch release');
    } finally {
      setIsBatchReleasing(false);
    }
  };

  const toggleOnHold = async (requestId: string) => {
    const token = localStorage.getItem('token');
    try {
      const res = await api.patch(`/api/requests/${requestId}/hold`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const newStatus = res.data.status;
      toast.success(newStatus === 'on_hold' ? 'Request placed On Hold' : 'Request removed from On Hold');
      loadAllData(); // Refresh all data
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to toggle hold status');
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

  const markReconciled = async (requestId: string, reconciled: boolean, note?: string) => {
    const token = localStorage.getItem('token');
    try {
      await api.patch(
        `/api/requests/${requestId}/reconcile`,
        { reconciled, discrepancy_note: note },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      toast.success(reconciled ? 'Marked as reconciled' : 'Reconciliation removed');
      fetchReconciliationItems();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to update reconciliation');
    }
  };

  const exportAuditLog = () => {
    const filtered = auditLogs.filter(log => {
      if (auditFilter.action !== 'all' && log.action !== auditFilter.action) return false;
      if (auditFilter.date_from && log.created_at < auditFilter.date_from) return false;
      if (auditFilter.date_to && log.created_at > auditFilter.date_to) return false;
      return true;
    });

    const doc = new jsPDF();
    doc.text('Audit Trail Report', 14, 20);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 30);
    
    autoTable(doc, {
      startY: 40,
      head: [['Date', 'Action', 'User', 'Role', 'Details']],
      body: filtered.map(log => [
        formatDateTime(log.created_at),
        log.action,
        log.actor_name,
        log.actor_role,
        log.details || '-'
      ]),
      headStyles: { fillColor: [49, 72, 122] }
    });
    
    doc.save(`Audit_Trail_${new Date().toISOString().slice(0,10)}.pdf`);
    toast.success('Audit log exported!');
  };

  const filteredReleases = useMemo(() => {
    return pendingReleases.filter(req => {
      // Handle On Hold filter
      if (releaseFilter.status === 'on_hold') {
        return req.status === 'on_hold';
      }
      // Exclude on-hold requests from other filters
      if (req.status === 'on_hold') return false;
      
      if (releaseFilter.status !== 'all' && req.status !== releaseFilter.status) return false;
      if (releaseFilter.date_from && req.submitted_at < releaseFilter.date_from) return false;
      if (releaseFilter.date_to && req.submitted_at > releaseFilter.date_to) return false;
      return true;
    });
  }, [pendingReleases, releaseFilter]);

  const filteredReconciliation = useMemo(() => {
    if (reconciliationFilter === 'all') return reconciliationItems;
    if (reconciliationFilter === 'reconciled') return reconciliationItems.filter(r => r.reconciled);
    if (reconciliationFilter === 'unreconciled') return reconciliationItems.filter(r => !r.reconciled);
    return reconciliationItems;
  }, [reconciliationItems, reconciliationFilter]);

  const filteredAuditLogs = useMemo(() => {
    return auditLogs.filter(log => {
      if (auditFilter.action !== 'all' && log.action !== auditFilter.action) return false;
      if (auditFilter.date_from && log.created_at < auditFilter.date_from) return false;
      if (auditFilter.date_to && log.created_at > auditFilter.date_to) return false;
      return true;
    });
  }, [auditLogs, auditFilter]);

  if (user?.role !== 'accounting' && user?.role !== 'admin') {
    return (
      <div className="panel text-center py-12">
        <p className="text-[var(--role-text)]/60">This page is only accessible to Accounting and Admin users.</p>
      </div>
    );
  }

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
        <h1 className="page-title">Accounting Control Center</h1>
        <p className="page-subtitle">Manage fund releases, petty cash, reconciliation, and audit trails.</p>
      </div>

      {/* Tab Navigation */}
      <div className="mb-6 flex flex-wrap gap-2">
        {[
          { key: 'overview', label: 'Overview', icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
          )},
          { key: 'petty_cash', label: 'Petty Cash', icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          )},
          { key: 'releases', label: 'Release Tracking', icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
          )},
          { key: 'reconciliation', label: 'Reconciliation', icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          )},
          { key: 'audit', label: 'Audit Trail', icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
          )}
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`btn-secondary flex items-center ${activeTab === tab.key ? 'bg-[var(--role-accent)] border-[var(--role-secondary)]' : ''}`}
          >
            <span className="mr-2">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* OVERVIEW TAB */}
      {activeTab === 'overview' && (
        <div className="space-y-6 animate-fade-in-up">
          {/* Stats Cards */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
            <div className="panel card-lift">
              <p className="text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/60">Pending Releases</p>
              <p className="mt-2 text-3xl font-bold text-[var(--role-text)]">{stats.total_pending}</p>
              <p className="mt-1 text-sm text-[var(--role-text)]/60">Requests awaiting release</p>
            </div>
            <div className="panel card-lift">
              <p className="text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/60">On Hold</p>
              <p className={`mt-2 text-3xl font-bold ${stats.on_hold_count > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                {stats.on_hold_count}
              </p>
              <p className="mt-1 text-sm text-[var(--role-text)]/60">Requests temporarily held</p>
            </div>
            <div className="panel card-lift">
              <p className="text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/60">Released Today</p>
              <p className="mt-2 text-3xl font-bold text-emerald-600">{stats.total_released_today}</p>
              <p className="mt-1 text-sm text-[var(--role-text)]/60">Today's processed releases</p>
            </div>
            <div className="panel card-lift">
              <p className="text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/60">Released This Month</p>
              <p className="mt-2 text-3xl font-bold text-[var(--role-primary)]">{stats.total_released_this_month}</p>
              <p className="mt-1 text-sm text-[var(--role-text)]/60">Monthly total</p>
            </div>
            <div className="panel card-lift">
              <p className="text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/60">Petty Cash Alerts</p>
              <p className={`mt-2 text-3xl font-bold ${stats.petty_cash_alerts > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                {stats.petty_cash_alerts}
              </p>
              <p className="mt-1 text-sm text-[var(--role-text)]/60">Departments need attention</p>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="panel">
            <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
            <div className="flex flex-wrap gap-3">
              <button onClick={() => setActiveTab('releases')} className="btn-primary">
                View Pending Releases
              </button>
              <button onClick={() => setActiveTab('petty_cash')} className="btn-secondary">
                Check Petty Cash
              </button>
              <button onClick={() => setActiveTab('reconciliation')} className="btn-secondary">
                Reconcile Releases
              </button>
              <button onClick={loadAllData} className="btn-secondary">
                Refresh All Data
              </button>
            </div>
          </div>

          {/* Recent Activity */}
          <div className="panel">
            <h3 className="text-lg font-semibold mb-4">Recent Releases (Today)</h3>
            {recentReleases.length === 0 ? (
              <p className="text-[var(--role-text)]/60">No releases today yet.</p>
            ) : (
              <div className="space-y-3">
                {recentReleases.slice(0, 5).map(release => (
                  <div key={release.id} className="flex items-center justify-between p-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-accent)]">
                    <div>
                      <p className="font-medium">{release.request_code}</p>
                      <p className="text-sm text-[var(--role-text)]/60">{release.item_name}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{formatMoney(toNumber(release.amount))}</p>
                      <p className="text-xs text-[var(--role-text)]/60">{formatDateTime(release.released_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* PETTY CASH TAB */}
      {activeTab === 'petty_cash' && (
        <div className="space-y-6 animate-fade-in-up">
          {/* Alerts Section */}
          {pettyCashAlerts.length > 0 && (
            <div className="rounded-[24px] border border-amber-300/30 bg-amber-500/10 p-4">
              <h3 className="text-lg font-semibold text-amber-800 mb-3">⚠️ Petty Cash Alerts</h3>
              <div className="space-y-2">
                {pettyCashAlerts.map(alert => (
                  <div key={alert.department_id} className="flex items-center justify-between p-3 rounded-xl bg-white/50">
                    <div>
                      <p className="font-medium">{alert.department_name}</p>
                      <p className="text-sm text-amber-700">
                        Balance: {formatMoney(alert.current_balance)} (Below {alert.alert_type === 'critical' ? '20%' : '50%'} of threshold)
                      </p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      alert.alert_type === 'critical' 
                        ? 'bg-red-100 text-red-700' 
                        : 'bg-amber-100 text-amber-700'
                    }`}>
                      {alert.alert_type === 'critical' ? 'CRITICAL' : 'LOW'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Petty Cash Management */}
          <div className="panel">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
              <div>
                <h3 className="text-lg font-semibold">Petty Cash History</h3>
                <p className="text-sm text-[var(--role-text)]/60">View transactions by department</p>
              </div>
              <div className="flex gap-3">
                <select 
                  className="field-input w-auto"
                  value={selectedDeptForPetty}
                  onChange={(e) => {
                    setSelectedDeptForPetty(e.target.value);
                    fetchPettyCashHistory(e.target.value);
                  }}
                >
                  <option value="">Select Department</option>
                  {departments.map(dept => (
                    <option key={dept.id} value={dept.id}>{dept.name}</option>
                  ))}
                </select>
                <button 
                  onClick={() => selectedDeptForPetty && fetchPettyCashHistory(selectedDeptForPetty)}
                  className="btn-secondary"
                >
                  Refresh
                </button>
              </div>
            </div>

            {selectedDeptForPetty ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between p-4 rounded-xl bg-[var(--role-accent)]">
                  <p className="font-medium">Current Balance</p>
                  <p className="text-2xl font-bold">
                    {formatMoney(toNumber(departments.find(d => d.id === selectedDeptForPetty)?.petty_cash_balance))}
                  </p>
                </div>

                {pettyCashHistory.length === 0 ? (
                  <p className="text-[var(--role-text)]/60 text-center py-8">No petty cash transactions found.</p>
                ) : (
                  <div className="space-y-2">
                    {pettyCashHistory.map((tx: any) => (
                      <div key={tx.id} className="flex items-center justify-between p-3 rounded-xl border border-[var(--role-border)]">
                        <div className="flex items-center gap-3">
                          <span className={`w-2 h-2 rounded-full ${tx.type === 'replenishment' ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                          <div>
                            <p className="font-medium capitalize">{tx.type}</p>
                            <p className="text-sm text-[var(--role-text)]/60">{tx.purpose}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`font-semibold ${tx.type === 'replenishment' ? 'text-emerald-600' : 'text-amber-600'}`}>
                            {tx.type === 'replenishment' ? '+' : '-'}{formatMoney(toNumber(tx.amount))}
                          </p>
                          <p className="text-xs text-[var(--role-text)]/60">{formatDateTime(tx.transaction_date)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[var(--role-text)]/60 text-center py-8">Select a department to view petty cash history.</p>
            )}
          </div>

          {/* Petty Cash Settings */}
          <div className="panel">
            <h3 className="text-lg font-semibold mb-4">Alert Settings</h3>
            <div className="flex items-center gap-4">
              <label className="field-label mb-0">Low Balance Threshold:</label>
              <input
                type="number"
                className="field-input w-40"
                value={pettyCashThreshold}
                onChange={(e) => setPettyCashThreshold(Number(e.target.value))}
              />
              <button onClick={checkPettyCashAlerts} className="btn-secondary">
                Update Alerts
              </button>
            </div>
            <p className="text-sm text-[var(--role-text)]/60 mt-2">
              Alerts trigger when balance falls below 50% (warning) or 20% (critical) of this threshold.
            </p>
          </div>
        </div>
      )}

      {/* RELEASES TAB */}
      {activeTab === 'releases' && (
        <div className="space-y-6 animate-fade-in-up">
          {/* Batch Actions */}
          {selectedRequests.size > 0 && (
            <div className="rounded-[24px] border border-[var(--role-primary)]/30 bg-[var(--role-primary)]/10 p-4 flex items-center justify-between">
              <div>
                <p className="font-medium">{selectedRequests.size} requests selected</p>
                <p className="text-sm text-[var(--role-text)]/60">
                  {Array.from(selectedRequests).filter(id => filteredReleases.find(r => r.id === id)?.status !== 'on_hold').length} eligible for release
                  {Array.from(selectedRequests).filter(id => filteredReleases.find(r => r.id === id)?.status === 'on_hold').length > 0 && 
                    ` • ${Array.from(selectedRequests).filter(id => filteredReleases.find(r => r.id === id)?.status === 'on_hold').length} on hold`
                  }
                </p>
              </div>
              <button 
                onClick={handleBatchRelease}
                disabled={isBatchReleasing}
                className="btn-primary"
              >
                {isBatchReleasing ? 'Releasing...' : 'Batch Release Selected'}
              </button>
            </div>
          )}
          
          {/* Select All Toggle */}
          {filteredReleases.length > 0 && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  const allIds = filteredReleases.map(r => r.id);
                  const allSelected = allIds.every(id => selectedRequests.has(id));
                  if (allSelected) {
                    // Deselect all
                    setSelectedRequests(prev => {
                      const next = new Set(prev);
                      allIds.forEach(id => next.delete(id));
                      return next;
                    });
                  } else {
                    // Select all
                    setSelectedRequests(prev => {
                      const next = new Set(prev);
                      allIds.forEach(id => next.add(id));
                      return next;
                    });
                  }
                }}
                className="btn-secondary !text-sm"
              >
                {filteredReleases.every(r => selectedRequests.has(r.id)) ? 'Deselect All' : 'Select All'}
              </button>
              <span className="text-sm text-[var(--role-text)]/60">
                {filteredReleases.length} requests visible
              </span>
            </div>
          )}

          {/* Filters */}
          <div className="panel">
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="field-label">Status</label>
                <select 
                  className="field-input"
                  value={releaseFilter.status}
                  onChange={(e) => setReleaseFilter(prev => ({ ...prev, status: e.target.value }))}
                >
                  <option value="all">All Status</option>
                  <option value="pending_accounting">Pending Accounting</option>
                  <option value="released">Released</option>
                  <option value="on_hold">On Hold</option>
                </select>
              </div>
              <div>
                <label className="field-label">From Date</label>
                <input 
                  type="date" 
                  className="field-input"
                  value={releaseFilter.date_from}
                  onChange={(e) => setReleaseFilter(prev => ({ ...prev, date_from: e.target.value }))}
                />
              </div>
              <div>
                <label className="field-label">To Date</label>
                <input 
                  type="date" 
                  className="field-input"
                  value={releaseFilter.date_to}
                  onChange={(e) => setReleaseFilter(prev => ({ ...prev, date_to: e.target.value }))}
                />
              </div>
              <button 
                onClick={() => setReleaseFilter({ status: 'pending_accounting', date_from: '', date_to: '' })}
                className="btn-secondary"
              >
                Reset Filters
              </button>
            </div>
          </div>

          {/* Releases List */}
          <div className="panel">
            <h3 className="text-lg font-semibold mb-4">
              {filteredReleases.length} Requests Found
            </h3>
            {filteredReleases.length === 0 ? (
              <p className="text-[var(--role-text)]/60 text-center py-8">No requests match the current filters.</p>
            ) : (
              <div className="space-y-3">
                {filteredReleases.map(req => (
                  <div key={req.id} className="flex items-center gap-4 p-4 rounded-xl border border-[var(--role-border)] bg-[var(--role-accent)]">
                    <input
                      type="checkbox"
                      checked={selectedRequests.has(req.id)}
                      onChange={() => toggleRequestSelection(req.id)}
                      className="w-5 h-5 rounded border-[var(--role-border)]"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <p className="font-medium">{req.request_code}</p>
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          req.status === 'on_hold'
                            ? 'bg-amber-100 text-amber-700 border border-amber-300'
                            : req.status === 'pending_accounting' 
                              ? 'bg-amber-50 text-amber-600' 
                              : 'bg-emerald-100 text-emerald-700'
                        }`}>
                          {req.status === 'on_hold' ? 'On Hold' : req.status.replace('_', ' ')}
                        </span>
                      </div>
                      <p className="text-sm text-[var(--role-text)]/60">{req.item_name}</p>
                    </div>
                    <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="font-semibold">{formatMoney(toNumber(req.amount))}</p>
                      <p className="text-xs text-[var(--role-text)]/60">
                        {req.status === 'on_hold'
                          ? `On Hold since: ${formatDateTime(req.on_hold_at || req.updated_at)}`
                          : req.status === 'pending_accounting' 
                            ? `Submitted: ${formatDateTime(req.submitted_at)}`
                            : `Released: ${formatDateTime(req.released_at)}`
                        }
                      </p>
                    </div>
                    {(req.status === 'pending_accounting' || req.status === 'on_hold') && (
                      <button
                        onClick={() => toggleOnHold(req.id)}
                        className={`px-3 py-1 rounded-full text-xs font-semibold ${
                          req.status === 'on_hold'
                            ? 'bg-amber-100 text-amber-700 border border-amber-300'
                            : 'bg-gray-100 text-gray-600 border border-gray-300 hover:bg-amber-50'
                        }`}
                        title={req.status === 'on_hold' ? 'Remove from On Hold' : 'Place On Hold'}
                      >
                        {req.status === 'on_hold' ? 'On Hold' : 'Hold'}
                      </button>
                    )}
                  </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* RECONCILIATION TAB */}
      {activeTab === 'reconciliation' && (
        <div className="space-y-6 animate-fade-in-up">
          {/* Filter */}
          <div className="panel">
            <div className="flex items-center gap-4">
              <label className="field-label mb-0">Show:</label>
              <select 
                className="field-input w-auto"
                value={reconciliationFilter}
                onChange={(e) => setReconciliationFilter(e.target.value)}
              >
                <option value="all">All Released</option>
                <option value="reconciled">Reconciled Only</option>
                <option value="unreconciled">Unreconciled Only</option>
              </select>
            </div>
          </div>

          {/* Reconciliation Table */}
          <div className="panel overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-[var(--role-border)]">
                <tr className="text-left text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/60">
                  <th className="pb-3">Request</th>
                  <th className="pb-3">Amount</th>
                  <th className="pb-3">Release Method</th>
                  <th className="pb-3">Reference</th>
                  <th className="pb-3">Released Date</th>
                  <th className="pb-3">Status</th>
                  <th className="pb-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--role-border)]">
                {filteredReconciliation.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-[var(--role-text)]/60">
                      No released requests found.
                    </td>
                  </tr>
                ) : (
                  filteredReconciliation.map(item => (
                    <tr key={item.id} className="text-sm">
                      <td className="py-3">
                        <p className="font-medium">{item.request_code}</p>
                      </td>
                      <td className="py-3">{formatMoney(item.amount)}</td>
                      <td className="py-3 capitalize">{item.release_method?.replace('_', ' ') || 'N/A'}</td>
                      <td className="py-3">{item.release_reference_no || 'N/A'}</td>
                      <td className="py-3">{formatDateTime(item.released_at)}</td>
                      <td className="py-3">
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          item.reconciled 
                            ? 'bg-emerald-100 text-emerald-700' 
                            : 'bg-amber-100 text-amber-700'
                        }`}>
                          {item.reconciled ? 'Reconciled' : 'Pending'}
                        </span>
                      </td>
                      <td className="py-3">
                        <div className="flex gap-2">
                          {!item.reconciled ? (
                            <button 
                              onClick={() => markReconciled(item.id, true)}
                              className="text-xs btn-success !px-2 !py-1"
                            >
                              Mark Reconciled
                            </button>
                          ) : (
                            <button 
                              onClick={() => markReconciled(item.id, false)}
                              className="text-xs btn-secondary !px-2 !py-1"
                            >
                              Unmark
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* AUDIT TRAIL TAB */}
      {activeTab === 'audit' && (
        <div className="space-y-6 animate-fade-in-up">
          {/* Filters */}
          <div className="panel">
            <div className="flex flex-wrap gap-4 items-end justify-between">
              <div className="flex flex-wrap gap-4 items-end">
                <div>
                  <label className="field-label">Action Type</label>
                  <select 
                    className="field-input"
                    value={auditFilter.action}
                    onChange={(e) => setAuditFilter(prev => ({ ...prev, action: e.target.value }))}
                  >
                    <option value="all">All Actions</option>
                    <option value="created">Created</option>
                    <option value="approved">Approved</option>
                    <option value="released">Released</option>
                    <option value="rejected">Rejected</option>
                    <option value="returned">Returned</option>
                  </select>
                </div>
                <div>
                  <label className="field-label">From Date</label>
                  <input 
                    type="date" 
                    className="field-input"
                    value={auditFilter.date_from}
                    onChange={(e) => setAuditFilter(prev => ({ ...prev, date_from: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="field-label">To Date</label>
                  <input 
                    type="date" 
                    className="field-input"
                    value={auditFilter.date_to}
                    onChange={(e) => setAuditFilter(prev => ({ ...prev, date_to: e.target.value }))}
                  />
                </div>
              </div>
              <button onClick={exportAuditLog} className="btn-primary">
                Export to PDF
              </button>
            </div>
          </div>

          {/* Audit Log List */}
          <div className="panel">
            <h3 className="text-lg font-semibold mb-4">Activity Log ({filteredAuditLogs.length} entries)</h3>
            {filteredAuditLogs.length === 0 ? (
              <p className="text-[var(--role-text)]/60 text-center py-8">
                No audit logs available. The audit system may need to be initialized.
              </p>
            ) : (
              <div className="space-y-3 max-h-[600px] overflow-y-auto">
                {filteredAuditLogs.map((log, index) => (
                  <div 
                    key={log.id || index} 
                    className="p-4 rounded-xl border border-[var(--role-border)] bg-[var(--role-accent)] animate-fade-in-up"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-1 rounded bg-[var(--role-primary)]/10 text-[var(--role-primary)] text-xs font-semibold capitalize">
                            {log.action}
                          </span>
                          {log.request_code && (
                            <span className="text-sm text-[var(--role-text)]/60">{log.request_code}</span>
                          )}
                        </div>
                        <p className="mt-2 text-sm">{log.details || `${log.action} by ${log.actor_name}`}</p>
                      </div>
                      <div className="text-right text-sm text-[var(--role-text)]/60">
                        <p>{log.actor_name}</p>
                        <p className="text-xs">{log.actor_role}</p>
                        <p className="text-xs mt-1">{formatDateTime(log.created_at)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AccountingDashboard;
