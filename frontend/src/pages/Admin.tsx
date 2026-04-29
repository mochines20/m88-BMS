import { useEffect, useMemo, useState } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import Modal from '../components/Modal';

const DEFAULT_FX_RATE = 56.0;
const FX_ENDPOINT = 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=PHP';

const formatMoney = (value: number, currency: 'PHP' | 'USD' = 'PHP') =>
  new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number.isFinite(value) ? value : 0);

const formatPercent = (value: number) => `${(Number.isFinite(value) ? value : 0).toFixed(2)}%`;

const formatDateTime = (value?: string) => {
  if (!value) return 'No timestamp';
  return new Date(value).toLocaleString();
};

const toUsd = (amount: number, fxRate: number) => amount / (fxRate || DEFAULT_FX_RATE);

const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getBudgetHealth = (department: any) => {
  const annualBudget = toNumber(department?.annual_budget);
  const usedBudget = toNumber(department?.used_budget);
  const projectedRemaining = toNumber(
    department?.projected_remaining_budget ?? department?.remaining_budget ?? annualBudget - usedBudget
  );
  const utilization = annualBudget > 0 ? (usedBudget / annualBudget) * 100 : 0;

  if (projectedRemaining < 0 || utilization >= 90) return 'critical';
  if (utilization >= 70) return 'high';
  return 'low';
};

const getDepartmentIdentityKey = (department: any) =>
  `${String(department?.name || '').trim().toLowerCase()}::${department?.fiscal_year ?? ''}`;

const pickPreferredDepartment = (current: any, candidate: any) => {
  const currentUsedBudget = toNumber(current?.used_budget);
  const candidateUsedBudget = toNumber(candidate?.used_budget);

  if (candidateUsedBudget !== currentUsedBudget) {
    return candidateUsedBudget > currentUsedBudget ? candidate : current;
  }

  const currentUpdatedAt = new Date(current?.updated_at || 0).getTime();
  const candidateUpdatedAt = new Date(candidate?.updated_at || 0).getTime();

  if (candidateUpdatedAt !== currentUpdatedAt) {
    return candidateUpdatedAt > currentUpdatedAt ? candidate : current;
  }

  return String(candidate?.id || '') < String(current?.id || '') ? candidate : current;
};

const statusTone = (status: string) => {
  switch (status) {
    case 'released':
      return 'border-[var(--role-border)] bg-[var(--role-accent)] text-[var(--role-text)]';
    case 'pending_supervisor':
    case 'pending_accounting':
      return 'border-[var(--role-secondary)]/18 bg-[var(--role-secondary)]/12 text-[var(--role-text)]';
    case 'rejected':
      return 'border-[var(--role-border)] bg-[var(--role-accent)] text-[var(--role-text)]/70';
    default:
      return 'border-[var(--role-border)] bg-[var(--role-accent)] text-[var(--role-text)]/70';
  }
};

const isLegacyDepartment = (name?: string) => /^m88/i.test(name || '');

const getDepartmentCode = (name?: string) => {
  const normalized = (name || '').trim().toLowerCase();

  if (normalized === 'it department' || normalized === 'm88it') return 'm88IT';
  if (normalized === 'purchasing department' || normalized === 'm88purchasing') return 'm88Purchasing';
  if (normalized === 'planning department' || normalized === 'm88planning') return 'm88Planning';
  if (normalized === 'logistics department' || normalized === 'm88logistics' || normalized === 'operations department') return 'm88logistics';
  if (normalized === 'hr department' || normalized === 'm88hr') return 'm88HR';
  if (normalized === 'finance department' || normalized === 'accounting department' || normalized === 'm88accounting') return 'm88accounting';
  if (normalized === 'admin department') return 'm88ADMIN';

  const compactName = (name || '').replace(/department/gi, '').replace(/[^a-z0-9]/gi, '');
  return compactName ? `m88${compactName}` : 'm88DEPT';
};

const getErrorMessage = (err: any, fallback: string) => {
  const data = err?.response?.data;

  if (typeof data === 'string' && data.trim()) {
    if (data.includes('Cannot POST /api/petty-cash/')) {
      return 'Petty cash endpoint is not loaded yet. Restart the local backend/server and try again.';
    }

    return data;
  }

  if (typeof data?.error === 'string' && data.error.trim()) {
    return data.error;
  }

  if (typeof data?.error?.message === 'string' && data.error.message.trim()) {
    return data.error.message;
  }

  return fallback;
};

const Admin = () => {
  const [departments, setDepartments] = useState<any[]>([]);
  const [managedUsers, setManagedUsers] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [systemHealth, setSystemHealth] = useState<any>(null);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string>('');
  const [selectedBreakdown, setSelectedBreakdown] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [user, setUser] = useState<any>(null);
  const [budgetInputs, setBudgetInputs] = useState<Record<string, string>>({});
  const [fxRate, setFxRate] = useState(DEFAULT_FX_RATE);
  const [fxRateUpdatedAt, setFxRateUpdatedAt] = useState('');
  const [fxStatus, setFxStatus] = useState<'live' | 'fallback'>('fallback');
  const [displayCurrency, setDisplayCurrency] = useState<'PHP' | 'USD'>('PHP');
  const [selectedFiscalYear, setSelectedFiscalYear] = useState<number>(new Date().getFullYear());
  const [departmentSearch, setDepartmentSearch] = useState('');
  const [budgetHealthFilter, setBudgetHealthFilter] = useState<'all' | 'low' | 'high' | 'critical'>('all');
  const [newDept, setNewDept] = useState({
    name: '',
    annual_budget: '',
    fiscal_year: new Date().getFullYear()
  });
  const [pettyCashForm, setPettyCashForm] = useState({
    amount: '',
    purpose: '',
    action: 'replenish' as 'replenish' | 'disburse'
  });
  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    type: 'confirm' | 'alert' | 'prompt';
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
    type: 'confirm'
  });

  const visibleDepartments = useMemo(() => {
    const uniqueDepartments = new Map<string, any>();

    departments
      .filter(dept => !isLegacyDepartment(dept.name))
      .forEach((dept) => {
        const key = getDepartmentIdentityKey(dept);
        const existing = uniqueDepartments.get(key);
        uniqueDepartments.set(key, existing ? pickPreferredDepartment(existing, dept) : dept);
      });

    return Array.from(uniqueDepartments.values()).sort((left, right) => {
      const leftUsed = toNumber(left?.used_budget);
      const rightUsed = toNumber(right?.used_budget);

      if (rightUsed !== leftUsed) {
        return rightUsed - leftUsed;
      }

      const leftBudget = toNumber(left?.annual_budget);
      const rightBudget = toNumber(right?.annual_budget);
      const leftUtilization = leftBudget > 0 ? leftUsed / leftBudget : 0;
      const rightUtilization = rightBudget > 0 ? rightUsed / rightBudget : 0;

      if (rightUtilization !== leftUtilization) {
        return rightUtilization - leftUtilization;
      }

      return String(left?.name || '').localeCompare(String(right?.name || ''));
    });
  }, [departments]);

  const availableFiscalYears = useMemo(
    () =>
      Array.from(
        new Set(
          visibleDepartments
            .map((department) => Number(department?.fiscal_year || 0))
            .filter((year) => Number.isInteger(year) && year > 0)
        )
      ).sort((left, right) => right - left),
    [visibleDepartments]
  );

  const filteredVisibleDepartments = useMemo(() => {
    const searchTerm = departmentSearch.trim().toLowerCase();

    return visibleDepartments.filter((department) => {
      const matchesYear = !selectedFiscalYear || Number(department.fiscal_year) === Number(selectedFiscalYear);
      const matchesName =
        !searchTerm ||
        String(department?.name || '').toLowerCase().includes(searchTerm) ||
        String(getDepartmentCode(department?.name || '')).toLowerCase().includes(searchTerm);
      const matchesHealth = budgetHealthFilter === 'all' || getBudgetHealth(department) === budgetHealthFilter;

      return matchesYear && matchesName && matchesHealth;
    });
  }, [visibleDepartments, selectedFiscalYear, departmentSearch, budgetHealthFilter]);

  useEffect(() => {
    if (!availableFiscalYears.length) return;
    if (!availableFiscalYears.includes(selectedFiscalYear)) {
      setSelectedFiscalYear(availableFiscalYears[0]);
      setNewDept((current) => ({ ...current, fiscal_year: availableFiscalYears[0] }));
    }
  }, [availableFiscalYears, selectedFiscalYear]);

  useEffect(() => {
    if (!filteredVisibleDepartments.length) {
      setSelectedDepartmentId('');
      return;
    }

    const selectedStillVisible = filteredVisibleDepartments.some((department) => department.id === selectedDepartmentId);
    if (!selectedStillVisible) {
      setSelectedDepartmentId(filteredVisibleDepartments[0].id);
    }
  }, [filteredVisibleDepartments, selectedDepartmentId]);

  useEffect(() => {
    fetchUser();
    fetchDepartments();
    fetchExchangeRate(false);

    const fxIntervalId = window.setInterval(() => {
      fetchExchangeRate(false);
    }, 60000);

    return () => window.clearInterval(fxIntervalId);
  }, []);

  useEffect(() => {
    if (user?.role === 'super_admin') {
      void fetchManagedUsers();
      void fetchAuditLogs();
      void fetchSystemHealth();
    }
  }, [user?.role]);

  const fetchSystemHealth = async () => {
    const token = localStorage.getItem('token');
    try {
      const res = await api.get('/api/system/health', { headers: { Authorization: `Bearer ${token}` } });
      setSystemHealth(res.data);
    } catch {
      setSystemHealth(null);
    }
  };

  useEffect(() => {
    if (!selectedDepartmentId) return;

    fetchDepartmentBreakdown(selectedDepartmentId, true, false);

    const intervalId = window.setInterval(() => {
      fetchDepartments(false);
      fetchDepartmentBreakdown(selectedDepartmentId, false, false);
    }, 15000);

    return () => window.clearInterval(intervalId);
  }, [selectedDepartmentId]);

  const fetchUser = async () => {
    const token = localStorage.getItem('token');
    try {
      const res = await api.get('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
      setUser(res.data);
    } catch (err) {
      toast.error('Failed to fetch user info');
    }
  };

  const fetchExchangeRate = async (showToast = false) => {
    try {
      const response = await fetch(FX_ENDPOINT);
      const data = await response.json();
      const latestRate = toNumber(data?.rates?.PHP);
      if (latestRate > 0) {
        setFxRate(latestRate);
        setFxRateUpdatedAt(data?.date || new Date().toISOString());
        setFxStatus('live');
      }
    } catch {
      setFxStatus('fallback');
      if (!fxRateUpdatedAt) {
        setFxRateUpdatedAt(new Date().toISOString());
      }
      if (showToast) {
        toast.error('Failed to refresh exchange rate');
      }
    }
  };

  const fetchDepartments = async (showError = true) => {
    const token = localStorage.getItem('token');
    try {
      const res = await api.get('/api/departments', { headers: { Authorization: `Bearer ${token}` } });
      setDepartments(res.data);
      setBudgetInputs(prev => {
        const next = { ...prev };
        res.data.forEach((dept: any) => {
          if (!(dept.id in next)) next[dept.id] = '';
        });
        return next;
      });

      const nextVisibleDepartments: any[] = Array.from(
        res.data
          .filter((dept: any) => !isLegacyDepartment(dept.name))
          .reduce((map: Map<string, any>, dept: any) => {
            const key = getDepartmentIdentityKey(dept);
            const existing = map.get(key);
            map.set(key, existing ? pickPreferredDepartment(existing, dept) : dept);
            return map;
          }, new Map<string, any>())
          .values()
      );
      const firstVisibleDepartment = nextVisibleDepartments[0];
      if (firstVisibleDepartment) {
        const latestFiscalYear = Math.max(
          ...nextVisibleDepartments.map((department: any) => Number(department?.fiscal_year || 0)),
          new Date().getFullYear()
        );
        setSelectedFiscalYear((current) => current || latestFiscalYear);
        setNewDept((current) => ({ ...current, fiscal_year: current.fiscal_year || latestFiscalYear }));
      }
    } catch (err) {
      if (showError) toast.error('Failed to fetch departments');
    }
  };

  const fetchDepartmentBreakdown = async (
    departmentId: string,
    showLoading = true,
    showToast = true
  ) => {
    const token = localStorage.getItem('token');
    if (showLoading) setDetailLoading(true);
    setDetailError('');

    try {
      const res = await api.get(`/api/departments/${departmentId}/budget-breakdown`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSelectedBreakdown(res.data);
    } catch (err: any) {
      setSelectedBreakdown(null);
      const message = err.response?.data?.error?.message || err.response?.data?.error || 'Detailed breakdown is not available yet for this department.';
      setDetailError(String(message));
      if (showToast) toast.error(`Failed to load budget breakdown: ${message}`);
    } finally {
      if (showLoading) setDetailLoading(false);
    }
  };

  const updateBudget = async (deptId: string, budget: number) => {
    const token = localStorage.getItem('token');
    try {
      await api.patch(`/api/departments/${deptId}/budget`, { annual_budget: budget }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success('Budget updated!');
      await fetchDepartments(false);
      await fetchDepartmentBreakdown(deptId, false, false);
      setBudgetInputs(prev => ({ ...prev, [deptId]: '' }));
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Failed to update budget'));
    }
  };

  const createDepartment = async () => {
    const token = localStorage.getItem('token');
    try {
      await api.post(
        '/api/departments',
        {
          name: newDept.name,
          annual_budget: toNumber(newDept.annual_budget),
          fiscal_year: newDept.fiscal_year
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      toast.success(
        newDept.fiscal_year >= activeFiscalYear
          ? `FY ${newDept.fiscal_year} is now available for departments, new signups, and new tickets.`
          : 'Department created!'
      );
      setNewDept({
        name: '',
        annual_budget: '',
        fiscal_year: selectedFiscalYear || availableFiscalYears[0] || new Date().getFullYear()
      });
      setSelectedFiscalYear(newDept.fiscal_year);
      await fetchDepartments(false);
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Failed to create department'));
    }
  };

  const fetchManagedUsers = async () => {
    const token = localStorage.getItem('token');
    try {
      const res = await api.get('/api/auth/users', { headers: { Authorization: `Bearer ${token}` } });
      setManagedUsers(res.data || []);
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Failed to fetch users'));
    }
  };

  const fetchAuditLogs = async () => {
    const token = localStorage.getItem('token');
    try {
      const res = await api.get('/api/requests/audit-logs', { headers: { Authorization: `Bearer ${token}` } });
      setAuditLogs(res.data || []);
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Failed to fetch audit logs'));
    }
  };

  const updateManagedUser = async (userId: string, updates: { name: string; role: string; department_id: string }) => {
    const token = localStorage.getItem('token');
    try {
      await api.patch(`/api/auth/users/${userId}`, updates, { headers: { Authorization: `Bearer ${token}` } });
      toast.success('User updated!');
      await fetchManagedUsers();
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Failed to update user'));
    }
  };

  const deleteManagedUser = (userId: string, email: string) => {
    setModalConfig({
      isOpen: true,
      title: 'Delete Account',
      message: `Are you sure you want to delete the account for ${email}? This action cannot be undone and all associated data will be removed.`,
      type: 'confirm',
      onConfirm: async () => {
        const token = localStorage.getItem('token');
        try {
          await api.delete(`/api/auth/users/${userId}`, { headers: { Authorization: `Bearer ${token}` } });
          toast.success('User deleted!');
          await fetchManagedUsers();
        } catch (err: any) {
          toast.error(getErrorMessage(err, 'Failed to delete user'));
        }
        setModalConfig(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const createNextFiscalYearDepartments = async () => {
    const token = localStorage.getItem('token');
    const baseDepartment = filteredVisibleDepartments[0] || visibleDepartments[0];
    const nextFiscalYear = (availableFiscalYears[0] || new Date().getFullYear()) + 1;

    try {
      await api.post(
        '/api/departments',
        {
          name: baseDepartment?.name || 'Finance Department',
          annual_budget: toNumber(baseDepartment?.annual_budget),
          fiscal_year: nextFiscalYear
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      toast.success(`FY ${nextFiscalYear} is now active for all departments, new signups, and new tickets.`);
      setSelectedFiscalYear(nextFiscalYear);
      setSelectedDepartmentId('');
      setNewDept({
        name: '',
        annual_budget: '',
        fiscal_year: nextFiscalYear
      });
      await fetchDepartments(false);
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Failed to create the next fiscal year departments'));
    }
  };

  const submitPettyCashAdjustment = async () => {
    const token = localStorage.getItem('token');
    const amount = toNumber(pettyCashForm.amount);
    const purpose = pettyCashForm.purpose.trim();

    if (!selectedDepartmentId) {
      toast.error('Select a department first');
      return;
    }

    if (amount <= 0) {
      toast.error('Enter a valid petty cash amount');
      return;
    }

    if (!purpose) {
      toast.error('Reason is required');
      return;
    }

    try {
      const endpoint = pettyCashForm.action === 'replenish' ? '/api/petty-cash/replenish' : '/api/petty-cash/disburse';
      await api.post(
        endpoint,
        {
          department_id: selectedDepartmentId,
          amount,
          purpose
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      toast.success(pettyCashForm.action === 'replenish' ? 'Petty cash added!' : 'Petty cash deducted!');
      setPettyCashForm({
        amount: '',
        purpose: '',
        action: pettyCashForm.action
      });
      await fetchDepartments(false);
      await fetchDepartmentBreakdown(selectedDepartmentId, false, false);
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Failed to update petty cash'));
    }
  };

  const selectedDepartment = filteredVisibleDepartments.find(dept => dept.id === selectedDepartmentId);
  const breakdownDepartment = selectedBreakdown?.department;
  const breakdownTotals = selectedBreakdown?.totals;
  const breakdownCounts = selectedBreakdown?.counts;
  const editableBudgetValue = breakdownTotals?.annual_budget ?? toNumber(selectedDepartment?.annual_budget);
  const editableBudgetDepartmentId = selectedDepartment?.id || selectedDepartmentId;
  const activeFiscalYear = availableFiscalYears[0] || selectedFiscalYear || new Date().getFullYear();

  const overview = useMemo(() => {
    const totalBudget = filteredVisibleDepartments.reduce((sum, dept) => sum + toNumber(dept.annual_budget), 0);
    const usedBudget = filteredVisibleDepartments.reduce((sum, dept) => sum + toNumber(dept.used_budget), 0);
    const remainingBudget = totalBudget - usedBudget;

    return {
      totalDepartments: filteredVisibleDepartments.length,
      totalBudget,
      usedBudget,
      remainingBudget,
      utilization: totalBudget > 0 ? (usedBudget / totalBudget) * 100 : 0
    };
  }, [filteredVisibleDepartments]);

  const displayAmount = (value: number) =>
    displayCurrency === 'USD'
      ? toUsd(toNumber(value), fxRate)
      : toNumber(value);

  const displayMoney = (value: number) => formatMoney(displayAmount(value), displayCurrency);
  const secondaryMoney = (value: number) =>
    displayCurrency === 'PHP'
      ? formatMoney(toUsd(toNumber(value), fxRate), 'USD')
      : formatMoney(toNumber(value), 'PHP');
  const remainingBudget = Math.max(overview.totalBudget - overview.usedBudget, 0);
  const overviewCards = [
    {
      label: 'Departments',
      value: overview.totalDepartments.toString(),
      helper: `${overview.totalDepartments === 1 ? 'Active department' : 'Active departments'} in budget view`,
      glow: 'bg-[var(--role-primary)]'
    },
    {
      label: 'Budget Pool',
      value: displayMoney(overview.totalBudget),
      helper: secondaryMoney(overview.totalBudget),
      glow: 'bg-[var(--role-secondary)]'
    },
    {
      label: 'Used',
      value: displayMoney(overview.usedBudget),
      helper: `Remaining ${displayMoney(remainingBudget)}`,
      glow: 'bg-[var(--role-primary)]'
    },
    {
      label: 'Utilization',
      value: formatPercent(overview.utilization),
      helper: `${displayMoney(remainingBudget)} still available`,
      glow: 'bg-[var(--role-secondary)]'
    }
  ];

  if (user?.role === 'super_admin') {
    return (
      <div className="text-[var(--role-text)]">
        <div className="page-header">
          <h1 className="page-title">Super Admin Console</h1>
          <p className="page-subtitle">Manage user access and review the latest system audit activity.</p>
        </div>

        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="panel !p-5">
              <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--role-text)]/60">System Status</p>
              <h3 className="mt-3 text-2xl font-bold text-[var(--role-text)]" style={{ color: systemHealth?.backend?.status === 'healthy' ? '#10B981' : '#EF4444' }}>
                {systemHealth?.backend?.status === 'healthy' ? 'Healthy' : 'Degraded'}
              </h3>
              <p className="mt-1 text-xs text-[var(--role-text)]/70">Server Uptime: {Math.floor((systemHealth?.backend?.uptime || 0) / 3600)}h {Math.floor(((systemHealth?.backend?.uptime || 0) % 3600) / 60)}m</p>
            </div>
            <div className="panel !p-5">
              <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--role-text)]/60">Database</p>
              <h3 className="mt-3 text-2xl font-bold text-[var(--role-text)]" style={{ color: systemHealth?.supabase?.status === 'healthy' ? '#10B981' : '#EF4444' }}>
                {systemHealth?.supabase?.status === 'healthy' ? 'Connected' : 'Error'}
              </h3>
              <p className="mt-1 text-xs text-[var(--role-text)]/70">{systemHealth?.supabase?.error || 'All systems operational'}</p>
            </div>
            <div className="panel !p-5">
              <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--role-text)]/60">Total Users</p>
              <h3 className="mt-3 text-2xl font-bold text-[var(--role-text)]">{systemHealth?.counts?.users || 0}</h3>
              <p className="mt-1 text-xs text-[var(--role-text)]/70">Registered accounts</p>
            </div>
            <div className="panel !p-5">
              <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--role-text)]/60">Active Depts</p>
              <h3 className="mt-3 text-2xl font-bold text-[var(--role-text)]">{systemHealth?.counts?.departments || 0}</h3>
              <p className="mt-1 text-xs text-[var(--role-text)]/70">Fiscal departments</p>
            </div>
          </div>

          <div className="panel">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold text-[var(--role-text)]">User Management</h2>
                <p className="mt-2 text-[var(--role-text)]/70">Update names, roles, and department assignments from one place.</p>
              </div>
              <button className="btn-secondary" onClick={() => void fetchManagedUsers()}>Refresh Users</button>
            </div>

            <div className="mt-5 space-y-4">
              {managedUsers.map((managedUser) => (
                <div key={managedUser.id} className="rounded-[24px] border border-[var(--role-border)] bg-[var(--role-accent)] p-4">
                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.1fr)_220px_260px_140px_120px]">
                    <input
                      className="field-input"
                      value={managedUser.name || ''}
                      onChange={(e) => setManagedUsers((current) => current.map((entry) => entry.id === managedUser.id ? { ...entry, name: e.target.value } : entry))}
                    />
                    <select
                      className="field-input"
                      value={managedUser.role || 'employee'}
                      onChange={(e) => setManagedUsers((current) => current.map((entry) => entry.id === managedUser.id ? { ...entry, role: e.target.value } : entry))}
                    >
                      <option value="employee">Employee</option>
                      <option value="supervisor">Supervisor</option>
                      <option value="accounting">Accounting</option>
                      <option value="admin">Admin</option>
                      <option value="super_admin">Super Admin</option>
                    </select>
                    <select
                      className="field-input"
                      value={managedUser.department_id || ''}
                      onChange={(e) => setManagedUsers((current) => current.map((entry) => entry.id === managedUser.id ? { ...entry, department_id: e.target.value } : entry))}
                      disabled={managedUser.role === 'super_admin'}
                    >
                      <option value="">No Department</option>
                      {departments.map((department) => (
                        <option key={department.id} value={department.id}>
                          {department.name} - FY {department.fiscal_year}
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn-primary"
                      onClick={() => void updateManagedUser(managedUser.id, {
                        name: managedUser.name || '',
                        role: managedUser.role || 'employee',
                        department_id: managedUser.role === 'super_admin' ? '' : (managedUser.department_id || '')
                      })}
                    >
                      Save User
                    </button>
                    <button
                      className="btn-danger"
                      onClick={() => void deleteManagedUser(managedUser.id, managedUser.email)}
                    >
                      Delete
                    </button>
                  </div>
                  <p className="mt-3 text-sm text-[var(--role-text)]/70">
                    {managedUser.email} • {managedUser.department_name || 'No department'} • Updated {formatDateTime(managedUser.updated_at)}
                  </p>
                </div>
              ))}
              {managedUsers.length === 0 && (
                <div className="panel-muted">
                  <p className="text-[var(--role-text)]/70">No users found.</p>
                </div>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold text-[var(--role-text)]">Audit Logs</h2>
                <p className="mt-2 text-[var(--role-text)]/70">Latest approval, allocation, and request-audit events across the system.</p>
              </div>
              <button className="btn-secondary" onClick={() => void fetchAuditLogs()}>Refresh Logs</button>
            </div>

            <div className="mt-5 space-y-3">
              {auditLogs.map((log: any, index: number) => (
                <div key={`${log.log_type}-${log.id || index}`} className="rounded-2xl border border-[var(--role-border)] bg-[var(--role-accent)] p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className="font-semibold text-[var(--role-text)] capitalize">
                        {log.log_type} • {log.action} • {log.request_code || 'No request code'}
                      </p>
                      <p className="mt-1 text-sm text-[var(--role-text)]/70">
                        {log.item_name || 'No item name'} • {log.request_status || 'No status'}
                      </p>
                      <p className="mt-2 text-sm text-[var(--role-text)]/80">{log.note || log.new_value || 'No note provided.'}</p>
                    </div>
                    <div className="text-sm text-[var(--role-text)]/60 lg:text-right">
                      <p>{log.actor_name || 'System'}</p>
                      <p className="capitalize">{log.actor_role || 'system'}</p>
                      <p>{formatDateTime(log.event_time || log.created_at || log.timestamp)}</p>
                    </div>
                  </div>
                </div>
              ))}
              {auditLogs.length === 0 && (
                <div className="panel-muted">
                  <p className="text-[var(--role-text)]/70">No audit logs available yet.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="text-[var(--role-text)]">
      <div className="page-header">
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="page-title">{user?.role === 'accounting' ? 'Accounting Panel' : 'Admin Panel'}</h1>
            <p className="page-subtitle">
              Automatic FX conversion, cleaner department list, and tighter budget cards for a more modern workspace.
            </p>
            <p className="mt-3 text-sm text-[var(--role-text)]/60">
              Active fiscal year for new signups and new tickets: <span className="font-semibold text-[var(--role-text)]">FY {activeFiscalYear}</span>
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.15fr)_360px]">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
              {overviewCards.map((card) => (
                <div
                  key={card.label}
                  className={`group relative overflow-hidden rounded-[28px] border border-[var(--role-border)] bg-[var(--role-surface)] p-5 shadow-[0_8px_32px_rgba(0,0,0,0.04)]`}
                >
                  <div className={`absolute -right-10 top-0 h-24 w-24 rounded-full blur-2xl ${card.glow} opacity-10`} />
                  <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[var(--role-secondary)]/10 to-transparent" />
                  <div className="relative flex h-full flex-col">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--role-text)]/60">{card.label}</p>
                    <p className="mt-4 break-words text-3xl font-bold leading-tight text-[var(--role-text)] sm:text-[2rem]">{card.value}</p>
                    <div className="mt-5 flex items-center justify-between gap-3 border-t border-[var(--role-border)] pt-4">
                      <p className="text-sm text-[var(--role-text)]/70">{card.helper}</p>
                      <span className="h-2 w-2 rounded-full bg-[var(--role-secondary)]/70 transition group-hover:scale-125 group-hover:bg-[var(--role-secondary)]" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="relative overflow-hidden rounded-[32px] border border-[var(--role-border)] bg-[var(--role-surface)] p-5 shadow-[0_8px_32px_rgba(0,0,0,0.04)]">
              <div className="absolute -right-12 -top-10 h-32 w-32 rounded-full bg-[var(--role-primary)]/5 blur-3xl" />
              <div className="absolute bottom-0 left-0 h-24 w-24 rounded-full bg-[var(--role-secondary)]/5 blur-2xl" />
              <div className="relative flex flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--role-text)]/50">Latest USD to PHP</p>
                    <p className="mt-3 text-4xl font-bold leading-none text-[var(--role-text)]">{fxRate.toFixed(4)}</p>
                    <p className="mt-2 text-sm text-[var(--role-text)]/60">1 USD = {fxRate.toFixed(4)} PHP</p>
                  </div>
                  <div className="rounded-[22px] border border-[var(--role-border)] bg-[var(--role-accent)] px-3 py-2 text-right">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--role-text)]/50">Display</p>
                    <p className="mt-1 text-sm font-semibold text-[var(--role-text)]">{displayCurrency}</p>
                  </div>
                </div>
                <span
                  className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                    fxStatus === 'live'
                      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700'
                      : 'border-[var(--role-border)] bg-[var(--role-accent)] text-[var(--role-text)]/70'
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${fxStatus === 'live' ? 'animate-pulse bg-emerald-500' : 'bg-[var(--role-text)]/30'}`}
                  />
                  {fxStatus === 'live' ? 'Live Rate' : 'Fallback'}
                </span>
                <div className="grid grid-cols-2 gap-3 rounded-[24px] border border-[var(--role-border)] bg-[var(--role-accent)] p-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--role-text)]/50">Updated</p>
                    <p className="mt-2 text-sm font-medium leading-snug text-[var(--role-text)]/80">
                      {fxRateUpdatedAt ? formatDateTime(fxRateUpdatedAt) : 'just now'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--role-text)]/50">Budget Health</p>
                    <p className="mt-2 text-sm font-medium text-[var(--role-text)]">{formatPercent(overview.utilization)} utilized</p>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--role-border)]">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[var(--role-primary)] to-[var(--role-secondary)]"
                        style={{ width: `${Math.min(100, Math.max(overview.utilization, 0))}%` }}
                      />
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-[var(--role-border)] bg-[var(--role-accent)] px-2.5 py-1 text-[11px] text-[var(--role-text)]/60">
                  Updated {fxRateUpdatedAt ? formatDateTime(fxRateUpdatedAt) : 'just now'}
                  </span>
                  {fxStatus === 'fallback' && (
                    <span className="rounded-full border border-[var(--role-border)] bg-[var(--role-accent)] px-2.5 py-1 text-[11px] text-[var(--role-text)]/60">
                      Offline
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    className="btn-primary flex-1"
                    onClick={() => setDisplayCurrency((current) => (current === 'PHP' ? 'USD' : 'PHP'))}
                  >
                    {displayCurrency === 'PHP' ? 'Convert All to USD' : 'Show All in PHP'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-[300px_minmax(0,1fr)] 2xl:grid-cols-[320px_minmax(0,1fr)]">
        {(user?.role === 'accounting' || user?.role === 'admin') && (
          <div className="panel xl:sticky xl:top-24 xl:self-start">
            <div className="mb-5">
              <h2 className="text-xl font-bold text-[var(--role-text)]">Departments</h2>
              <p className="mt-1 text-sm text-[var(--role-text)]/60">Legacy `m88...` entries are now hidden from this view.</p>
              <p className="mt-2 text-xs text-[var(--role-text)]/50">
                Each fiscal year stays separate, so FY 2024, FY 2025, FY 2026, and FY 2027 are filtered independently.
              </p>
            </div>

            <div className="space-y-4">
              <div className="space-y-3 rounded-[24px] border border-[var(--role-border)] bg-[var(--role-accent)] p-4">
                <div className="flex flex-wrap gap-2">
                  {availableFiscalYears.map((year) => (
                    <button
                      key={year}
                      type="button"
                      onClick={() => setSelectedFiscalYear(year)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] transition ${
                        selectedFiscalYear === year
                          ? 'border-[var(--role-secondary)] bg-[var(--role-secondary)] text-[var(--role-text-inverse)]'
                          : 'border-[var(--role-border)] bg-[var(--role-surface)] text-[var(--role-text)]/60 hover:border-[var(--role-secondary)]/50 hover:text-[var(--role-text)]'
                      }`}
                    >
                      FY {year}
                    </button>
                  ))}
                </div>
                <input
                  className="field-input"
                  placeholder="Filter by department name"
                  value={departmentSearch}
                  onChange={(event) => setDepartmentSearch(event.target.value)}
                />
                <select
                  className="field-input"
                  value={budgetHealthFilter}
                  onChange={(event) => setBudgetHealthFilter(event.target.value as 'all' | 'low' | 'high' | 'critical')}
                >
                  <option value="all">All Budget Health</option>
                  <option value="low">Low Utilization</option>
                  <option value="high">High Utilization</option>
                  <option value="critical">Critical Budget</option>
                </select>
              </div>

              {filteredVisibleDepartments.map((dept) => {
                const isSelected = dept.id === selectedDepartmentId;
                const annualBudget = toNumber(dept.annual_budget);
                const usedBudget = toNumber(dept.used_budget);
                const remaining = toNumber(dept.remaining_budget || (annualBudget - usedBudget));
                const projectedRemaining = toNumber(dept.projected_remaining_budget || remaining);
                const utilization = annualBudget > 0 ? (usedBudget / annualBudget) * 100 : 0;
                const budgetHealth = getBudgetHealth(dept);

                return (
                  <button
                    key={dept.id}
                    onClick={() => setSelectedDepartmentId(dept.id)}
                    className={`w-full overflow-hidden rounded-[24px] border text-left transition ${
                      isSelected
                        ? 'border-[var(--role-secondary)]/50 bg-[var(--role-accent)] shadow-[0_8px_32px_rgba(0,0,0,0.06)]'
                        : 'border-[var(--role-border)] bg-[var(--role-surface)] hover:border-[var(--role-secondary)]/30 hover:bg-[var(--role-accent)]/50'
                    }`}
                  >
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <span className="inline-flex rounded-full border border-[var(--role-border)] bg-[var(--role-accent)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--role-text)]/70">
                            {getDepartmentCode(dept.name)}
                          </span>
                          <h3 className="text-base font-semibold text-[var(--role-text)]">{dept.name}</h3>
                          <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/50">Fiscal Year {dept.fiscal_year}</p>
                        </div>
                        <span className="rounded-full border border-[var(--role-border)] bg-[var(--role-accent)] px-2.5 py-1 text-xs text-[var(--role-text)]/70">
                          {formatPercent(utilization)}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--role-text)]/50">Budget Health</span>
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${
                          budgetHealth === 'critical'
                            ? 'border-red-500/20 bg-red-500/10 text-red-600'
                            : budgetHealth === 'high'
                              ? 'border-orange-500/20 bg-orange-500/10 text-orange-600'
                              : 'border-[var(--role-border)] bg-[var(--role-accent)] text-[var(--role-text)]/60'
                        }`}>
                          {budgetHealth}
                        </span>
                      </div>

                      <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--role-border)]">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[var(--role-primary)] to-[var(--role-secondary)]"
                          style={{ width: `${Math.min(utilization, 100)}%` }}
                        />
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-3">
                        <div className="rounded-2xl border border-[var(--role-border)] bg-[var(--role-accent)] p-3">
                          <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--role-text)]/50">Total</p>
                          <p className="mt-2 break-words text-sm font-semibold leading-tight text-[var(--role-text)]">{displayMoney(annualBudget)}</p>
                        </div>
                        <div className="rounded-2xl border border-[var(--role-border)] bg-[var(--role-accent)] p-3">
                          <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--role-text)]/50">Remaining</p>
                          <p className="mt-2 break-words text-sm font-semibold leading-tight text-[var(--role-text)]">{displayMoney(remaining)}</p>
                          <p className="mt-1 text-[11px] text-[var(--role-text)]/50">Projected: {displayMoney(projectedRemaining)}</p>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
              {filteredVisibleDepartments.length === 0 && (
                <div className="rounded-[24px] border border-[var(--role-border)] bg-[var(--role-accent)] p-4 text-sm text-[var(--role-text)]/60">
                  No departments matched the current year or filter.
                </div>
              )}
            </div>
          </div>
        )}

        <div className="panel overflow-hidden">
          <div className="relative overflow-hidden rounded-[28px] border border-[var(--role-border)] bg-[var(--role-surface)] p-6 shadow-[0_8px_32px_rgba(0,0,0,0.04)]">
            <div className="absolute -right-16 -top-16 h-40 w-40 rounded-full bg-[var(--role-primary)]/5 blur-3xl" />
            <div className="absolute bottom-0 left-0 h-24 w-24 rounded-full bg-[var(--role-secondary)]/5 blur-2xl" />
            <div className="relative">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-[var(--role-text)]/50">Budget Workspace</p>
                <h2 className="mt-2 text-3xl font-bold text-[var(--role-text)]">
                  {selectedDepartment?.name || breakdownDepartment?.name || 'Budget Breakdown'}
                </h2>
                <div className="mt-3 inline-flex rounded-full border border-[var(--role-border)] bg-[var(--role-accent)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--role-text)]/70">
                  {getDepartmentCode(selectedDepartment?.name || breakdownDepartment?.name)}
                </div>
                <p className="mt-2 max-w-2xl text-sm text-[var(--role-text)]/60">
                  Automatic dollar-to-peso reference rate, centavo precision, and a polished financial summary without manual input.
                </p>
              </div>

            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-[var(--role-border)] bg-[var(--role-accent)] px-4 py-3 text-sm text-[var(--role-text)]/60 lg:flex-row lg:items-center lg:justify-between">
            <span>Auto-refresh every 15 seconds - Displaying all amounts in {displayCurrency}</span>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <span>Last synced: {formatDateTime(selectedBreakdown?.generated_at)}</span>
              <button
                className="btn-secondary !rounded-full !px-4 !py-2 text-sm"
                onClick={() => {
                  fetchExchangeRate(true);
                  if (selectedDepartmentId) fetchDepartmentBreakdown(selectedDepartmentId, true, true);
                }}
              >
                Refresh Detail
              </button>
            </div>
          </div>

          {detailLoading ? (
            <div className="py-16 text-center text-[var(--role-text)]/70">Loading detailed budget data...</div>
          ) : detailError || !breakdownDepartment || !breakdownTotals ? (
            <div className="mt-6 space-y-6">
              <div className="rounded-[28px] border border-[var(--role-border)] bg-[var(--role-accent)] p-8 text-center">
                <p className="text-xl font-semibold text-[var(--role-text)]">Detailed breakdown unavailable</p>
                <p className="mt-2 text-[var(--role-text)]/60">{detailError || 'Select a department to view more details.'}</p>
                <button
                  className="btn-secondary mt-5"
                  onClick={() => {
                    fetchExchangeRate(true);
                    if (selectedDepartmentId) fetchDepartmentBreakdown(selectedDepartmentId, true, true);
                  }}
                >
                  Try Again
                </button>
              </div>

              {(user?.role === 'accounting' || user?.role === 'admin') && selectedDepartment && (
                <div className="space-y-6">
                  <div className="rounded-[28px] border border-[var(--role-border)] bg-[var(--role-accent)] p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-[var(--role-text)]">Budget Update</h3>
                        <p className="mt-1 text-sm text-[var(--role-text)]/60">
                          You can still update the total budget while the detailed breakdown route is being refreshed.
                        </p>
                      </div>
                      <div className="rounded-full border border-[var(--role-border)] bg-[var(--role-surface)] px-4 py-2 text-sm text-[var(--role-text)]/60">
                        Current Total: <span className="font-semibold text-[var(--role-text)]">{displayMoney(editableBudgetValue)}</span>
                      </div>
                    </div>

                    <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                      <input
                        type="number"
                        step="0.01"
                        placeholder="New Budget Amount"
                        className="field-input"
                        value={budgetInputs[editableBudgetDepartmentId] || ''}
                        onChange={(e) => setBudgetInputs(prev => ({ ...prev, [editableBudgetDepartmentId]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const value = parseFloat((e.target as HTMLInputElement).value);
                            if (value > 0 && editableBudgetDepartmentId) updateBudget(editableBudgetDepartmentId, value);
                          }
                        }}
                      />
                      <button
                        onClick={() => {
                          const value = parseFloat(budgetInputs[editableBudgetDepartmentId]);
                          if (value > 0 && editableBudgetDepartmentId) updateBudget(editableBudgetDepartmentId, value);
                        }}
                        className="btn-success"
                      >
                        Update Budget
                      </button>
                    </div>
                  </div>

                  <div className="rounded-[28px] border border-[var(--role-border)] bg-[var(--role-accent)] p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-[var(--role-text)]">Petty Cash Adjustment</h3>
                        <p className="mt-1 text-sm text-[var(--role-text)]/60">
                          Add or deduct petty cash with a required reason so every balance change has a clear audit note.
                        </p>
                      </div>
                      <div className="rounded-full border border-[var(--role-border)] bg-[var(--role-surface)] px-4 py-2 text-sm text-[var(--role-text)]/60">
                        Current Balance: <span className="font-semibold text-[var(--role-text)]">{displayMoney(breakdownTotals?.petty_cash_balance ?? selectedDepartment?.petty_cash_balance ?? 0)}</span>
                      </div>
                    </div>

                    <div className="mt-5 flex flex-col gap-3 2xl:flex-row 2xl:flex-wrap 2xl:items-stretch">
                      <div className="min-w-0 2xl:w-[180px] 2xl:flex-none">
                        <select
                          className="field-input w-full"
                          value={pettyCashForm.action}
                          onChange={(e) => setPettyCashForm(prev => ({ ...prev, action: e.target.value as 'replenish' | 'disburse' }))}
                        >
                          <option value="replenish">Add Cash</option>
                          <option value="disburse">Deduct Cash</option>
                        </select>
                      </div>
                      <div className="min-w-0 2xl:min-w-[280px] 2xl:flex-[1_1_280px]">
                        <input
                          type="text"
                          className="field-input w-full"
                          placeholder={pettyCashForm.action === 'replenish' ? 'Reason for replenishment' : 'Reason for deduction'}
                          value={pettyCashForm.purpose}
                          onChange={(e) => setPettyCashForm(prev => ({ ...prev, purpose: e.target.value }))}
                        />
                      </div>
                      <div className="min-w-0 2xl:w-[220px] 2xl:flex-none">
                        <input
                          type="number"
                          step="0.01"
                          className="field-input w-full"
                          placeholder="Amount"
                          value={pettyCashForm.amount}
                          onChange={(e) => setPettyCashForm(prev => ({ ...prev, amount: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') submitPettyCashAdjustment();
                          }}
                        />
                      </div>
                      <div className="min-w-0 2xl:w-[160px] 2xl:flex-none">
                        <button onClick={submitPettyCashAdjustment} className="btn-success w-full">
                          Save Change
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-6 space-y-6">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-2">
                <div className="rounded-[24px] border border-[var(--role-border)] bg-[var(--role-accent)] p-5">
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--role-text)]/60">Annual Budget</p>
                  <p className="mt-3 break-words text-2xl font-bold leading-tight text-[var(--role-text)]">{displayMoney(breakdownTotals.annual_budget)}</p>
                  <p className="mt-2 text-sm text-[var(--role-text)]/70">{secondaryMoney(breakdownTotals.annual_budget)}</p>
                </div>
                <div className="rounded-[24px] border border-[var(--role-border)] bg-[var(--role-accent)] p-5">
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--role-text)]/60">Used Budget</p>
                  <p className="mt-3 break-words text-2xl font-bold leading-tight text-[var(--role-text)]">{displayMoney(breakdownTotals.used_budget)}</p>
                  <p className="mt-2 text-sm text-[var(--role-text)]/70">{secondaryMoney(breakdownTotals.used_budget)}</p>
                </div>
                <div className="rounded-[24px] border border-[var(--role-border)] bg-[var(--role-accent)] p-5">
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--role-text)]/60">Remaining Budget</p>
                  <p className="mt-3 break-words text-2xl font-bold leading-tight text-[var(--role-text)]">{displayMoney(breakdownDepartment.remaining_budget)}</p>
                  <p className="mt-2 text-sm text-[var(--role-text)]/70">{secondaryMoney(breakdownDepartment.remaining_budget)}</p>
                </div>
                <div className="rounded-[24px] border border-[var(--role-border)] bg-[var(--role-accent)] p-5">
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--role-text)]/60">Utilization</p>
                  <p className="mt-3 text-3xl font-bold text-[var(--role-text)]">{formatPercent(breakdownDepartment.utilization_percentage)}</p>
                  <p className="mt-2 text-sm text-[var(--role-text)]/70 break-words">Committed: {displayMoney(breakdownDepartment.projected_committed_total)}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.08fr)_340px] 2xl:grid-cols-[minmax(0,1.12fr)_360px]">
                <div className="space-y-6">
                  <div className="rounded-[28px] border border-[var(--role-border)] bg-[var(--role-accent)] p-5">
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-[var(--role-text)]">Detailed Breakdown</h3>
                        <p className="mt-1 text-sm text-[var(--role-text)]/70">Fiscal Year {breakdownDepartment.fiscal_year}</p>
                      </div>
                      <div className="rounded-full border border-[var(--role-border)] bg-[var(--role-surface)] px-4 py-2 text-sm text-[var(--role-text)]/80">
                        Projected Remaining: <span className="font-semibold text-[var(--role-text)]">{displayMoney(breakdownDepartment.projected_remaining_budget)}</span>
                      </div>
                    </div>

                    <div className="mt-5 grid grid-cols-1 gap-3 2xl:grid-cols-2">
                      <div className="rounded-2xl border border-[var(--role-border)] bg-[var(--role-surface)] p-4">
                        <p className="text-sm text-[var(--role-text)]/70">Released Requests</p>
                        <p className="mt-2 break-words text-2xl font-semibold leading-tight text-[var(--role-text)]">{displayMoney(breakdownTotals.released_requests_total)}</p>
                        <p className="text-sm text-[var(--role-text)]/60">{secondaryMoney(breakdownTotals.released_requests_total)}</p>
                      </div>
                      <div className="rounded-2xl border border-[var(--role-border)] bg-[var(--role-surface)] p-4">
                        <p className="text-sm text-[var(--role-text)]/70">Direct Expenses</p>
                        <p className="mt-2 break-words text-2xl font-semibold leading-tight text-[var(--role-text)]">{displayMoney(breakdownTotals.direct_expenses_total)}</p>
                        <p className="text-sm text-[var(--role-text)]/60">{secondaryMoney(breakdownTotals.direct_expenses_total)}</p>
                      </div>
                      <div className="rounded-2xl border border-[var(--role-border)] bg-[var(--role-surface)] p-4">
                        <p className="text-sm text-[var(--role-text)]/70">Pending Supervisor</p>
                        <p className="mt-2 break-words text-2xl font-semibold leading-tight text-[var(--role-text)]">{displayMoney(breakdownTotals.pending_supervisor_total)}</p>
                        <p className="text-sm text-[var(--role-text)]/60">{breakdownCounts.pending_supervisor} active request(s)</p>
                      </div>
                      <div className="rounded-2xl border border-[var(--role-border)] bg-[var(--role-surface)] p-4">
                        <p className="text-sm text-[var(--role-text)]/70">Pending Accounting</p>
                        <p className="mt-2 break-words text-2xl font-semibold leading-tight text-[var(--role-text)]">{displayMoney(breakdownTotals.pending_accounting_total)}</p>
                        <p className="text-sm text-[var(--role-text)]/60">{breakdownCounts.pending_accounting} active request(s)</p>
                      </div>
                      <div className="rounded-2xl border border-[var(--role-border)] bg-[var(--role-surface)] p-4">
                        <p className="text-sm text-[var(--role-text)]/70">Petty Cash Balance</p>
                        <p className="mt-2 break-words text-2xl font-semibold leading-tight text-[var(--role-text)]">{displayMoney(breakdownTotals.petty_cash_balance)}</p>
                        <p className="text-sm text-[var(--role-text)]/60">
                          In: {displayMoney(breakdownTotals.petty_cash_replenished_total)} • Out: {displayMoney(breakdownTotals.petty_cash_disbursed_total)}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-[var(--role-border)] bg-[var(--role-surface)] p-4">
                        <p className="text-sm text-[var(--role-text)]/70">Breakdown Variance</p>
                        <p className="mt-2 break-words text-2xl font-semibold leading-tight text-[var(--role-text)]">{displayMoney(breakdownDepartment.breakdown_variance)}</p>
                        <p className="text-sm text-[var(--role-text)]/60">Closer to `0.00` means the rollup is aligned.</p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[28px] border border-[var(--role-border)] bg-[var(--role-accent)] p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-[var(--role-text)]">Budget Update</h3>
                        <p className="mt-1 text-sm text-[var(--role-text)]/70">
                          Adjust the annual allocation with centavo precision. Example: `500000.75`
                        </p>
                      </div>
                      <div className="rounded-full border border-[var(--role-border)] bg-[var(--role-surface)] px-4 py-2 text-sm text-[var(--role-text)]/70">
                        Current Total: <span className="font-semibold text-[var(--role-text)]">{displayMoney(breakdownTotals.annual_budget)}</span>
                      </div>
                    </div>

                    <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                      <input
                        type="number"
                        step="0.01"
                        placeholder="New Budget Amount"
                        className="field-input"
                        value={budgetInputs[selectedDepartmentId] || ''}
                        onChange={(e) => setBudgetInputs(prev => ({ ...prev, [selectedDepartmentId]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const value = parseFloat((e.target as HTMLInputElement).value);
                            if (value > 0 && selectedDepartmentId) updateBudget(selectedDepartmentId, value);
                          }
                        }}
                      />
                      <button
                        onClick={() => {
                          const value = parseFloat(budgetInputs[selectedDepartmentId]);
                          if (value > 0 && selectedDepartmentId) updateBudget(selectedDepartmentId, value);
                        }}
                        className="btn-success"
                      >
                        Update Budget
                      </button>
                    </div>
                  </div>

                  {(user?.role === 'accounting' || user?.role === 'admin') && (
                    <div className="rounded-[28px] border border-[var(--role-border)] bg-[var(--role-accent)] p-5">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                          <h3 className="text-lg font-semibold text-[var(--role-text)]">Petty Cash Adjustment</h3>
                          <p className="mt-1 text-sm text-[var(--role-text)]/70">
                            Record every petty cash add or deduction with the reason for the balance change.
                          </p>
                        </div>
                        <div className="rounded-full border border-[var(--role-border)] bg-[var(--role-surface)] px-4 py-2 text-sm text-[var(--role-text)]/70">
                          Current Balance: <span className="font-semibold text-[var(--role-text)]">{displayMoney(breakdownTotals.petty_cash_balance)}</span>
                        </div>
                      </div>

                      <div className="mt-5 flex flex-col gap-3 2xl:flex-row 2xl:flex-wrap 2xl:items-stretch">
                        <div className="min-w-0 2xl:w-[180px] 2xl:flex-none">
                          <select
                            className="field-input w-full"
                            value={pettyCashForm.action}
                            onChange={(e) => setPettyCashForm(prev => ({ ...prev, action: e.target.value as 'replenish' | 'disburse' }))}
                          >
                            <option value="replenish">Add Cash</option>
                            <option value="disburse">Deduct Cash</option>
                          </select>
                        </div>
                        <div className="min-w-0 2xl:min-w-[280px] 2xl:flex-[1_1_280px]">
                          <input
                            type="text"
                            className="field-input w-full"
                            placeholder={pettyCashForm.action === 'replenish' ? 'Reason for replenishment' : 'Reason for deduction'}
                            value={pettyCashForm.purpose}
                            onChange={(e) => setPettyCashForm(prev => ({ ...prev, purpose: e.target.value }))}
                          />
                        </div>
                        <div className="min-w-0 2xl:w-[220px] 2xl:flex-none">
                          <input
                            type="number"
                            step="0.01"
                            className="field-input w-full"
                            placeholder="Amount"
                            value={pettyCashForm.amount}
                            onChange={(e) => setPettyCashForm(prev => ({ ...prev, amount: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') submitPettyCashAdjustment();
                            }}
                          />
                        </div>
                        <div className="min-w-0 2xl:w-[160px] 2xl:flex-none">
                          <button onClick={submitPettyCashAdjustment} className="btn-success w-full">
                            Save Change
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-6">
                  <div className="rounded-[28px] border border-[var(--role-border)] bg-[var(--role-accent)] p-5">
                    <h3 className="text-lg font-semibold text-[var(--role-text)]">Quick Totals</h3>
                    <div className="mt-5 grid grid-cols-2 gap-3">
                      <div className="rounded-2xl border border-[var(--role-border)] bg-[var(--role-surface)] p-4">
                        <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--role-text)]/60">Requests</p>
                        <p className="mt-2 text-2xl font-bold text-[var(--role-text)]">{breakdownCounts.total_requests}</p>
                      </div>
                      <div className="rounded-2xl border border-[var(--role-border)] bg-[var(--role-surface)] p-4">
                        <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--role-text)]/60">Released</p>
                        <p className="mt-2 text-2xl font-bold text-[var(--role-text)]">{breakdownCounts.released_requests}</p>
                      </div>
                      <div className="rounded-2xl border border-[var(--role-border)] bg-[var(--role-surface)] p-4">
                        <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--role-text)]/60">Direct Expenses</p>
                        <p className="mt-2 text-2xl font-bold text-[var(--role-text)]">{breakdownCounts.direct_expenses}</p>
                      </div>
                      <div className="rounded-2xl border border-[var(--role-border)] bg-[var(--role-surface)] p-4">
                        <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--role-text)]/60">Petty Cash Txns</p>
                        <p className="mt-2 text-2xl font-bold text-[var(--role-text)]">{breakdownCounts.petty_cash_transactions}</p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[28px] border border-[var(--role-border)] bg-[var(--role-accent)] p-5">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-lg font-semibold text-[var(--role-text)]">Recent Requests</h3>
                      <span className="text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/60">Latest 8</span>
                    </div>
                    <div className="mt-4 space-y-3">
                      {selectedBreakdown.recent_requests.length === 0 && (
                        <p className="text-sm text-[var(--role-text)]/70">No recent requests for this department.</p>
                      )}
                      {selectedBreakdown.recent_requests.map((request: any) => {
                        const allocatedAmount = toNumber(request.department_allocation_amount || request.amount);
                        const requestAmount = toNumber(request.amount);

                        return (
                        <div key={request.id} className="rounded-2xl border border-[var(--role-border)] bg-[var(--role-surface)] p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold text-[var(--role-text)]">{request.item_name}</p>
                              {request.allocation_count > 1 && (
                                <p className="mt-1 text-xs text-[var(--role-text)]/60">
                                  Shared request split across {request.allocation_count} departments
                                </p>
                              )}
                              <p className="mt-1 text-sm text-[var(--role-text)]/70">{request.request_code} • {request.category}</p>
                            </div>
                            <span className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize ${statusTone(request.status)}`}>
                              {request.status.replace('_', ' ')}
                            </span>
                          </div>
                          <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                            <div>
                              <p className="font-semibold text-[var(--role-text)]">{displayMoney(allocatedAmount)}</p>
                              {allocatedAmount !== requestAmount && (
                                <p className="mt-1 text-xs text-[var(--role-text)]/60">
                                  Request total {displayMoney(requestAmount)}
                                </p>
                              )}
                            </div>
                            <p className="text-[var(--role-text)]/60">{formatDateTime(request.submitted_at || request.updated_at)}</p>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="rounded-[28px] border border-[var(--role-border)] bg-[var(--role-accent)] p-5">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-lg font-semibold text-[var(--role-text)]">Recent Petty Cash</h3>
                      <span className="text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/60">Latest 8</span>
                    </div>
                    <div className="mt-4 space-y-3">
                      {selectedBreakdown.recent_petty_cash_transactions.length === 0 && (
                        <p className="text-sm text-[var(--role-text)]/70">No petty cash activity yet.</p>
                      )}
                      {selectedBreakdown.recent_petty_cash_transactions.map((transaction: any) => (
                        <div key={transaction.id} className="rounded-2xl border border-[var(--role-border)] bg-[var(--role-surface)] p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold capitalize text-[var(--role-text)]">{transaction.type}</p>
                              <p className="mt-1 text-sm text-[var(--role-text)]/70">{transaction.purpose || 'No purpose provided.'}</p>
                            </div>
                            <p className="font-semibold text-[var(--role-text)]">{displayMoney(toNumber(transaction.amount))}</p>
                          </div>
                          <p className="mt-3 text-xs text-[var(--role-text)]/60">{formatDateTime(transaction.transaction_date || transaction.created_at)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {(user?.role === 'admin' || user?.role === 'accounting') && (
        <div className="panel">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-2xl font-bold text-[var(--role-text)]">Add New Department</h2>
              <p className="mt-2 text-[var(--role-text)]/60">Accounting and admin can add one department or generate the whole next fiscal year from this panel.</p>
            </div>
            <button
              className="btn-secondary w-full lg:w-auto"
              onClick={createNextFiscalYearDepartments}
            >
              Add All Departments For FY {activeFiscalYear + 1}
            </button>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
            <input className="field-input" placeholder="Department Name" value={newDept.name} onChange={e => setNewDept({...newDept, name: e.target.value})} />
            <input className="field-input" type="number" step="0.01" placeholder="Annual Budget" value={newDept.annual_budget} onChange={e => setNewDept({...newDept, annual_budget: e.target.value})} />
            <input className="field-input" type="number" placeholder="Fiscal Year" value={newDept.fiscal_year} onChange={e => setNewDept({...newDept, fiscal_year: Number(e.target.value)})} />
          </div>
          <button
            className="btn-primary mt-4 w-full md:w-auto"
            onClick={createDepartment}
          >
            Create Department
          </button>
        </div>
      )}
      <Modal
        isOpen={modalConfig.isOpen}
        title={modalConfig.title}
        message={modalConfig.message}
        type={modalConfig.type}
        onClose={() => setModalConfig(prev => ({ ...prev, isOpen: false }))}
        onConfirm={modalConfig.onConfirm}
        confirmLabel={modalConfig.type === 'confirm' ? 'Delete Account' : 'Confirm'}
      />
    </div>
  );
};

export default Admin;
