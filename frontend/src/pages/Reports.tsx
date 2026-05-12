import { useEffect, useMemo, useState } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts';
import { toNumber, formatMoney, formatDateTime , getErrorMessage } from '../utils/format';

interface DepartmentOption {
  id: string;
  name: string;
  fiscal_year?: number;
}

interface ReportFilterOptions {
  departments: DepartmentOption[];
  categories: string[];
  fiscal_years: number[];
}

const normalizeDepartmentName = (value: string) => String(value || '').trim();
const normalizeDepartmentKey = (value: string) => normalizeDepartmentName(value).toLowerCase();
const getDepartmentFilterKey = (department: { name?: string; fiscal_year?: number }) =>
  `${normalizeDepartmentKey(String(department?.name || ''))}::${department?.fiscal_year ?? ''}`;
const LEGACY_TO_CANONICAL_DEPARTMENT: Record<string, string> = {
  m88it: 'IT Department',
  m88purchasing: 'Purchasing Department',
  m88planning: 'Planning Department',
  m88logistics: 'Logistics Department',
  m88hr: 'HR Department',
  m88accounting: 'Finance Department',
  m88admin: 'Admin Department',
  'accounting department': 'Finance Department'
};

const toCanonicalDepartmentName = (value: string) => {
  const normalizedValue = normalizeDepartmentName(value);
  if (!normalizedValue) return '';
  return LEGACY_TO_CANONICAL_DEPARTMENT[normalizeDepartmentKey(normalizedValue)] || normalizedValue;
};


const normalizeFilterOptions = (raw: Partial<ReportFilterOptions> | null | undefined): ReportFilterOptions => {
  const uniqueDepartments = new Map<string, DepartmentOption>();

  (raw?.departments || []).forEach((department) => {
    const canonicalName = toCanonicalDepartmentName(department.name);
    const key = getDepartmentFilterKey({ name: canonicalName, fiscal_year: department.fiscal_year });
    const current = uniqueDepartments.get(key);

    if (!current || String(department.id) < String(current.id)) {
      uniqueDepartments.set(key, {
        id: department.id,
        name: canonicalName,
        fiscal_year: department.fiscal_year
      });
    }
  });

  const categories = Array.from(
    new Set((raw?.categories || []).map((category) => String(category || '').trim()).filter(Boolean))
  ).sort((left, right) => left.localeCompare(right));

  return {
    departments: Array.from(uniqueDepartments.values()).sort((left, right) => left.name.localeCompare(right.name)),
    categories,
    fiscal_years: Array.from(new Set((raw as any)?.fiscal_years || [])).map(Number).filter(Boolean).sort((left, right) => right - left)
  };
};

const Reports = () => {
  const [filters, setFilters] = useState({
    dept: '',
    fiscal_year: String(new Date().getFullYear()),
    from: '',
    to: '',
    status: '',
    archived: 'false',
    category: ''
  });
  const [summary, setSummary] = useState<any>(null);
  const [requests, setRequests] = useState<any[]>([]);
  const [summaryLoaded, setSummaryLoaded] = useState(false);
  const [requestsLoaded, setRequestsLoaded] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [filterOptions, setFilterOptions] = useState<ReportFilterOptions>({
    departments: [],
    categories: [],
    fiscal_years: []
  });
  const [activeTab, setActiveTab] = useState<'requests' | 'cash_advance'>('requests');
  const [agingType, setAgingType] = useState<'all' | 'overdue' | 'due_soon'>('all');
  const [cashAdvanceAging, setCashAdvanceAging] = useState<any[]>([]);
  const [agingSummary, setAgingSummary] = useState<any>(null);
  const [agingLoaded, setAgingLoaded] = useState(false);
  const [budgetMonitoring, setBudgetMonitoring] = useState<any[]>([]);
  const [budgetMonitoringLoaded, setBudgetMonitoringLoaded] = useState(false);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;
  
  // Track filter changes for auto-refresh indicator
  const [lastFetchedFilters, setLastFetchedFilters] = useState(filters);
  const filtersChanged = JSON.stringify(filters) !== JSON.stringify(lastFetchedFilters);
  
  // Archive confirmation state
  const [archiveConfirm, setArchiveConfirm] = useState<{
    isOpen: boolean;
    requestId: string;
    archived: boolean;
  }>({ isOpen: false, requestId: '', archived: false });

  const getAuthHeaders = () => {
    const token = localStorage.getItem('token');
    return { Authorization: `Bearer ${token}` };
  };

  const fetchUser = async () => {
    try {
      const res = await api.get('/api/auth/me', { headers: getAuthHeaders() });
      setUser(res.data);
    } catch {
      // User not authenticated
    }
  };

  const fetchBudgetMonitoring = async () => {
    try {
      const params = new URLSearchParams({
        fiscal_year: filters.fiscal_year || String(new Date().getFullYear()),
        ...(filters.dept ? { department_id: filters.dept } : {})
      });
      const res = await api.get(`/api/budget/monitoring?${params.toString()}`, {
        headers: getAuthHeaders()
      });
      setBudgetMonitoring(res.data || []);
      setBudgetMonitoringLoaded(true);
    } catch {
      setBudgetMonitoring([]);
      setBudgetMonitoringLoaded(true);
      toast.error('Failed to fetch budget monitoring data');
    }
  };

  const fetchFallbackFilterOptions = async () => {
    const [departmentsRes, requestsRes] = await Promise.all([
      api.get('/api/departments', { headers: getAuthHeaders() }),
      api.get('/api/reports/requests', { headers: getAuthHeaders() })
    ]);

    const departments = (departmentsRes.data || []).map((department: any) => ({
      id: String(department.id),
      name: toCanonicalDepartmentName(String(department.name || '')),
      fiscal_year: Number(department.fiscal_year || 0) || undefined
    }));

    const categories = Array.from(
      new Set(
        (requestsRes.data || [])
          .map((request: any) => String(request.category || '').trim())
          .filter(Boolean)
      )
    ) as string[];

    categories.sort((left, right) => left.localeCompare(right));

    const fiscal_years = Array.from(
      new Set(
        [
          ...(departmentsRes.data || []).map((department: any) => Number(department.fiscal_year || 0)),
          ...(requestsRes.data || []).map((request: any) => Number(request.fiscal_year || request.departments?.fiscal_year || 0))
        ].filter((year) => Number.isInteger(year) && year > 0)
      )
    ).sort((left, right) => right - left);

    return normalizeFilterOptions({ departments, categories, fiscal_years } as any);
  };

  const fetchFilterOptions = async () => {
    try {
      const res = await api.get('/api/reports/filter-options', {
        headers: getAuthHeaders()
      });

      const normalized = normalizeFilterOptions(res.data);
      if (normalized.departments.length > 0 || normalized.categories.length > 0) {
        setFilterOptions(normalized);
        return;
      }

      const fallback = await fetchFallbackFilterOptions();
      setFilterOptions(fallback);
    } catch {
      try {
        const fallback = await fetchFallbackFilterOptions();
        setFilterOptions(fallback);
      } catch {
        toast.error('Failed to load report filters');
      }
    }
  };

  const fetchSummary = async () => {
    try {
      const params = new URLSearchParams(filters as any);
      const res = await api.get(`/api/reports/summary?${params}`, { headers: getAuthHeaders() });
      setSummary(res.data);
      setSummaryLoaded(true);
    } catch {
      toast.error('Failed to fetch summary');
    }
  };

  const fetchRequests = async () => {
    try {
      const params = new URLSearchParams(filters as any);
      const res = await api.get(`/api/reports/requests?${params}`, { headers: getAuthHeaders() });
      setRequests(res.data);
      setRequestsLoaded(true);
    } catch {
      toast.error('Failed to fetch requests');
    }
  };

  const fetchCashAdvanceAging = async () => {
    try {
      const res = await api.get('/api/sla/check-liquidations', { headers: getAuthHeaders() });
      setAgingSummary(res.data.summary);
      setCashAdvanceAging([
        ...(res.data.overdue || []).map((item: any) => ({ ...item, aging_status: 'overdue' })),
        ...(res.data.due_soon || []).map((item: any) => ({ ...item, aging_status: 'due_soon' })),
        ...(res.data.upcoming || []).map((item: any) => ({ ...item, aging_status: 'upcoming' }))
      ]);
      setAgingLoaded(true);
    } catch {
      toast.error('Failed to fetch cash advance aging');
    }
  };

  useEffect(() => {
    void fetchUser();
    void fetchFilterOptions();
    void fetchSummary();
    void fetchBudgetMonitoring();
  }, []);

  useEffect(() => {
    if (activeTab === 'cash_advance') {
      void fetchCashAdvanceAging();
    }
  }, [activeTab]);

  const exportReport = async (format: string) => {
    if (format === 'pdf') {
      const doc = new jsPDF();
      doc.setFontSize(18);
      doc.text('Madison88 Budget Request Report', 14, 22);
      doc.setFontSize(10);
      doc.text(`Generated: ${formatDateTime(new Date().toISOString())}`, 14, 30);
      doc.text(`Filters: FY ${filters.fiscal_year || 'All'}, Status: ${filters.status || 'All'}`, 14, 36);

      autoTable(doc, {
        startY: 42,
        head: [['Request Code', 'Department', 'Category', 'Item', 'Amount', 'Status', 'Submitted']],
        body: requests.map(req => [
          req.request_code,
          req.departments?.name || '-',
          req.category || '-',
          req.item_name?.substring(0, 30) + (req.item_name?.length > 30 ? '...' : ''),
          `PHP ${Number(req.amount).toLocaleString()}`,
          req.status?.replace('_', ' ') || '-',
          req.submitted_at ? formatDateTime(req.submitted_at) : '-'
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [49, 72, 122] }
      });

      doc.save('budget-report.pdf');
      toast.success('PDF downloaded!');
      return;
    }

    try {
      const params = new URLSearchParams({ ...filters, format });
      const res = await api.get(`/api/reports/summary?${params}`, {
        headers: getAuthHeaders(),
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `summary.${format}`);
      document.body.appendChild(link);
      link.click();
      toast.success('Report exported!');
    } catch {
      toast.error('Export failed');
    }
  };

  
  const chartColors = [
    'var(--role-primary)',
    'var(--role-secondary)',
    '#10B981', // Success emerald
    '#F59E0B', // Warning amber
    '#EF4444'  // Error red
  ];

  const statusChartData = [
    { name: 'Approved', value: summary?.approved || 0 },
    { name: 'Rejected', value: summary?.rejected || 0 },
    { name: 'Pending', value: (summary?.total_requests || 0) - ((summary?.approved || 0) + (summary?.rejected || 0)) }
  ].filter(d => d.value > 0);

  const monthlyChartData = requests.reduce((acc: any[], req) => {
    const month = req.submitted_at ? new Date(req.submitted_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : 'Unknown';
    const existing = acc.find(item => item.month === month);
    if (existing) {
      existing.amount += Number(req.amount);
      existing.count += 1;
    } else {
      acc.push({ month, amount: Number(req.amount), count: 1 });
    }
    return acc;
  }, []).sort((a, b) => new Date(a.month).getTime() - new Date(b.month).getTime());

  const categoryChartData = requests.reduce<{name: string; value: number}[]>((acc, req) => {
    const cat = req.category || 'Uncategorized';
    const existing = acc.find((item: {name: string; value: number}) => item.name === cat);
    if (existing) {
      existing.value += 1;
    } else {
      acc.push({ name: cat, value: 1 });
    }
    return acc;
  }, []).filter((d: {value: number}) => d.value > 0);

  const trialBalanceRows = Object.values(
    budgetMonitoring.reduce((acc: Record<string, any>, row: any) => {
      const key = `${row.department_id || 'unknown'}::${row.department_name || 'Unknown Department'}`;
      if (!acc[key]) {
        acc[key] = {
          department_id: row.department_id || 'unknown',
          department_name: row.department_name || 'Unknown Department',
          budget: 0,
          actual: 0,
          committed: 0,
          remaining: 0
        };
      }
      acc[key].budget += toNumber(row.budget);
      acc[key].actual += toNumber(row.actual);
      acc[key].committed += toNumber(row.committed);
      acc[key].remaining += toNumber(row.remaining);
      return acc;
    }, {})
  ) as any[];

  const trialBalanceTotals = trialBalanceRows.reduce(
    (totals, row) => ({
      budget: totals.budget + toNumber(row.budget),
      actual: totals.actual + toNumber(row.actual),
      committed: totals.committed + toNumber(row.committed),
      remaining: totals.remaining + toNumber(row.remaining)
    }),
    { budget: 0, actual: 0, committed: 0, remaining: 0 }
  );

  const profitLossRows = trialBalanceRows.map((row) => ({
    department_id: row.department_id,
    department_name: row.department_name,
    budget: toNumber(row.budget),
    expense_actual: toNumber(row.actual),
    expense_committed: toNumber(row.committed),
    variance: toNumber(row.budget) - (toNumber(row.actual) + toNumber(row.committed)),
    variance_pct: toNumber(row.budget) > 0
      ? (((toNumber(row.budget) - (toNumber(row.actual) + toNumber(row.committed))) / toNumber(row.budget)) * 100)
      : 0
  }));

  const archiveRequest = async (requestId: string, archived: boolean) => {
    setArchiveConfirm({ isOpen: true, requestId, archived });
  };
  
  const confirmArchive = async () => {
    const { requestId, archived } = archiveConfirm;
    try {
      await api.patch(`/api/requests/${requestId}/archive`, { archived }, { headers: getAuthHeaders() });
      toast.success(`Request ${archived ? 'archived' : 'unarchived'} successfully!`);
      setArchiveConfirm({ isOpen: false, requestId: '', archived: false });
      void fetchRequests();
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Archive operation failed'));
    }
  };

  // Export Trial Balance to PDF
  const exportTrialBalanceToPDF = () => {
    try {
      const doc = new jsPDF();
      doc.setFontSize(18);
      doc.text('Trial Balance Report', 14, 22);
      doc.setFontSize(10);
      doc.text(`Generated: ${formatDateTime(new Date().toISOString())}`, 14, 30);
      doc.text(`Fiscal Year: ${filters.fiscal_year || 'All'}`, 14, 36);

      autoTable(doc, {
        startY: 42,
        head: [['Department', 'Budget (Dr)', 'Actual (Cr)', 'Committed', 'Remaining']],
        body: [
          ...trialBalanceRows.map(row => [
            row.department_name,
            formatMoney(toNumber(row.budget)),
            formatMoney(toNumber(row.actual)),
            formatMoney(toNumber(row.committed)),
            formatMoney(toNumber(row.remaining))
          ]),
          ['TOTAL', 
            formatMoney(trialBalanceTotals.budget),
            formatMoney(trialBalanceTotals.actual),
            formatMoney(trialBalanceTotals.committed),
            formatMoney(trialBalanceTotals.remaining)
          ]
        ],
        styles: { fontSize: 9 },
        headStyles: { fillColor: [49, 72, 122] }
      });

      doc.save(`trial-balance-${new Date().toISOString().slice(0, 10)}.pdf`);
      toast.success('Trial Balance exported to PDF');
    } catch (err: any) {
      console.error('PDF export error:', err);
      toast.error('Failed to export Trial Balance to PDF. Please try again.');
    }
  };

  // Export P&L to PDF
  const exportPLToPDF = () => {
    try {
      const doc = new jsPDF();
      doc.setFontSize(18);
      doc.text('P&L by Department', 14, 22);
      doc.setFontSize(10);
      doc.text(`Generated: ${formatDateTime(new Date().toISOString())}`, 14, 30);
      doc.text(`Fiscal Year: ${filters.fiscal_year || 'All'}`, 14, 36);

      autoTable(doc, {
        startY: 42,
        head: [['Department', 'Budget', 'Actual Expense', 'Committed', 'Variance', 'Variance %']],
        body: profitLossRows.map(row => [
          row.department_name,
          formatMoney(row.budget),
          formatMoney(row.expense_actual),
          formatMoney(row.expense_committed),
          formatMoney(row.variance),
          `${row.variance_pct.toFixed(1)}%`
        ]),
        styles: { fontSize: 9 },
        headStyles: { fillColor: [49, 72, 122] }
      });

      doc.save(`pnl-report-${new Date().toISOString().slice(0, 10)}.pdf`);
      toast.success('P&L Report exported to PDF');
    } catch (err: any) {
      console.error('PDF export error:', err);
      toast.error('Failed to export P&L to PDF. Please try again.');
    }
  };

  // Pagination helper
  const paginatedRequests = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return requests.slice(startIndex, startIndex + pageSize);
  }, [requests, currentPage]);

  const totalPages = Math.ceil(requests.length / pageSize);

  // Reset to first page when requests change
  useEffect(() => {
    setCurrentPage(1);
  }, [filters.dept, filters.fiscal_year, filters.status, filters.category, filters.archived]);

  const Pagination = () => (
    <div className="flex items-center justify-between mt-4 pt-4 border-t border-[var(--role-border)]">
      <p className="text-sm text-[var(--role-text)]/60">
        Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, requests.length)} of {requests.length} requests
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
          disabled={currentPage === totalPages || totalPages === 0}
          className="px-3 py-1.5 rounded-lg border border-[var(--role-border)] bg-[var(--role-accent)] text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--role-accent)]/80 transition"
        >
          Next
        </button>
      </div>
    </div>
  );

  return (
    <div className="text-[var(--role-text)]">
      <div className="page-header">
        <h1 className="page-title">Reports</h1>
        <p className="page-subtitle">Filter expense activity, generate summaries, and export clean reports for management review.</p>
      </div>

      <div className="mb-6 flex gap-2">
        <button
          onClick={() => setActiveTab('requests')}
          className={`px-4 py-2 rounded-lg font-medium transition-all ${
            activeTab === 'requests'
              ? 'bg-[var(--role-primary)] text-[var(--role-text-inverse)] shadow-lg'
              : 'text-[var(--role-text)]/60 hover:bg-[var(--role-accent)] hover:text-[var(--role-text)]'
          }`}
        >
          All Requests
        </button>
        <button
          onClick={() => setActiveTab('cash_advance')}
          className={`flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold transition ${
            activeTab === 'cash_advance'
              ? 'bg-[var(--role-primary)] text-[var(--role-text-inverse)] shadow-lg'
              : 'bg-[var(--role-accent)] text-[var(--role-text)]/70 hover:bg-[var(--role-accent)]/80'
          }`}
        >
          Cash Advance Aging
        </button>
      </div>

      {activeTab === 'requests' && (
      <div className="panel mb-6">
        <h2 className="text-2xl font-bold text-[var(--role-text)]">Filters</h2>
        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
          <select className="field-input" value={filters.dept} onChange={e => setFilters({ ...filters, dept: e.target.value })}>
            <option value="">All Departments</option>
            {filterOptions.departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name} - FY {department.fiscal_year || 'N/A'}
              </option>
            ))}
          </select>
          <select className="field-input" value={filters.fiscal_year} onChange={e => setFilters({ ...filters, fiscal_year: e.target.value })}>
            <option value="">All Fiscal Years</option>
            {filterOptions.fiscal_years.map((year) => (
              <option key={year} value={year}>
                Fiscal Year {year}
              </option>
            ))}
          </select>
          <input className="field-input" type="date" placeholder="From Date" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value })} />
          <input className="field-input" type="date" placeholder="To Date" value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value })} />
          <select className="field-input" value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}>
            <option value="">All Statuses</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="pending_supervisor">Pending Supervisor</option>
            <option value="pending_accounting">Pending Accounting</option>
            <option value="returned_for_revision">Returned for Revision</option>
            <option value="released">Released</option>
          </select>
          <select className="field-input" value={filters.archived} onChange={e => setFilters({ ...filters, archived: e.target.value })}>
            <option value="false">Active</option>
            <option value="true">Archived</option>
            <option value="all">All</option>
          </select>
          <select className="field-input" value={filters.category} onChange={e => setFilters({ ...filters, category: e.target.value })}>
            <option value="">All Categories</option>
            {filterOptions.categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-5 flex flex-wrap gap-3 items-center">
          <button 
            onClick={() => { setLastFetchedFilters(filters); fetchSummary(); fetchRequests(); }} 
            className={`btn-primary ${filtersChanged ? 'ring-2 ring-amber-400 animate-pulse' : ''}`}
          >
            {filtersChanged ? '↻ Refresh with New Filters' : 'Generate Summary'}
          </button>
          {filtersChanged && (
            <span className="text-sm text-amber-600 font-medium">
              Filters changed — click refresh to update
            </span>
          )}
          <button onClick={() => exportReport('pdf')} className="btn-secondary">Export PDF</button>
          <button onClick={() => exportReport('excel')} className="btn-secondary">Export Excel</button>
        </div>
      </div>
      )}

      {summary && (
        <div className="panel mb-6">
          <h2 className="text-2xl font-bold text-[var(--role-text)]">Summary Report</h2>
          <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="panel-muted text-center">
              <p className="text-3xl font-bold text-[var(--role-text)]">{summary.total_requests}</p>
              <p className="mt-2 text-[var(--role-text)]/60">Total Requests</p>
            </div>
            <div className="panel-muted text-center">
              <p className="text-3xl font-bold text-[var(--role-primary)]">{summary.approved}</p>
              <p className="mt-2 text-[var(--role-text)]/60">Approved</p>
            </div>
            <div className="panel-muted text-center">
              <p className="text-3xl font-bold text-[var(--role-secondary)]">{summary.rejected}</p>
              <p className="mt-2 text-[var(--role-text)]/60">Rejected</p>
            </div>
            <div className="panel-muted text-center">
              <p className="text-3xl font-bold text-[var(--role-text)]">PHP {summary.total_amount.toFixed(2)}</p>
              <p className="mt-2 text-[var(--role-text)]/60">Total Amount</p>
            </div>
          </div>

        </div>
      )}

      {summary && requests.length > 0 && (
        <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="panel">
            <h3 className="text-lg font-bold text-[var(--role-text)]">Requests by Status</h3>
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={5}
                    dataKey="value"
                    label={({ name, percent }: any) => `${name || ''} ${((percent || 0) * 100).toFixed(0)}%`}
                  >
                    {statusChartData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={chartColors[index % chartColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'var(--role-surface)', borderColor: 'var(--role-border)', borderRadius: '12px', color: 'var(--role-text)' }}
                    itemStyle={{ color: 'var(--role-text)' }}
                    formatter={(value: any) => [value, 'Requests']} 
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel">
            <h3 className="text-lg font-bold text-[var(--role-text)]">Monthly Spending Trend</h3>
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthlyChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--role-border)" />
                  <XAxis dataKey="month" stroke="var(--role-text)" fontSize={12} />
                  <YAxis stroke="var(--role-text)" fontSize={12} tickFormatter={(v: number) => `₱${(v/1000).toFixed(0)}k`} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'var(--role-surface)', borderColor: 'var(--role-border)', borderRadius: '12px', color: 'var(--role-text)' }}
                    itemStyle={{ color: 'var(--role-text)' }}
                    formatter={(value: any) => [formatMoney(Number(value)), 'Amount']} 
                  />
                  <Line type="monotone" dataKey="amount" stroke="var(--role-primary)" strokeWidth={3} dot={{ fill: 'var(--role-primary)' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel">
            <h3 className="text-lg font-bold text-[var(--role-text)]">Requests by Category</h3>
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryChartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--role-border)" />
                  <XAxis type="number" stroke="var(--role-text)" fontSize={12} />
                  <YAxis dataKey="name" type="category" stroke="var(--role-text)" fontSize={10} width={100} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'var(--role-surface)', borderColor: 'var(--role-border)', borderRadius: '12px', color: 'var(--role-text)' }}
                    itemStyle={{ color: 'var(--role-text)' }}
                  />
                  <Bar dataKey="value" fill="var(--role-primary)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel">
            <h3 className="text-lg font-bold text-[var(--role-text)]">Department Budget Overview</h3>
            <div className="mt-4 space-y-3">
              {filterOptions.departments.slice(0, 5).map((dept) => {
                const deptRequests = requests.filter(r => r.department_id === dept.id);
                const totalAmount = deptRequests.reduce((sum, r) => sum + Number(r.amount), 0);
                return (
                  <div key={dept.id} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--role-text)]">{dept.name}</span>
                      <span className="text-[var(--role-text)]/60">{deptRequests.length} requests</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--role-border)]">
                      <div 
                        className="h-full rounded-full bg-gradient-to-r from-[var(--role-primary)] to-[var(--role-secondary)]"
                        style={{ width: `${Math.min((totalAmount / (summary?.total_amount || 1)) * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      )}

      {activeTab === 'requests' && (
        <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="panel lg:col-span-2">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-[var(--role-text)]">Trial Balance (Budget Ledger View)</h3>
              {trialBalanceRows.length > 0 && (
                <button
                  onClick={() => exportTrialBalanceToPDF()}
                  className="btn-secondary !py-1.5 !px-3 !text-xs"
                >
                  Export PDF
                </button>
              )}
            </div>
            {!budgetMonitoringLoaded ? (
              <p className="mt-3 text-sm text-[var(--role-text)]/60">Loading trial balance...</p>
            ) : trialBalanceRows.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--role-text)]/60">No budget monitoring data found for the selected filters.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm text-[var(--role-text)]">
                  <thead>
                    <tr className="table-header">
                      <th className="p-3 text-left">Department</th>
                      <th className="p-3 text-right">Budget (Dr)</th>
                      <th className="p-3 text-right">Actual (Cr)</th>
                      <th className="p-3 text-right">Committed</th>
                      <th className="p-3 text-right">Remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trialBalanceRows.map((row) => (
                      <tr key={`tb-${row.department_id}-${row.department_name}`} className="table-row">
                        <td className="p-3 font-medium">{row.department_name}</td>
                        <td className="p-3 text-right">{formatMoney(toNumber(row.budget))}</td>
                        <td className="p-3 text-right">{formatMoney(toNumber(row.actual))}</td>
                        <td className="p-3 text-right">{formatMoney(toNumber(row.committed))}</td>
                        <td className="p-3 text-right">{formatMoney(toNumber(row.remaining))}</td>
                      </tr>
                    ))}
                    <tr className="font-bold border-t border-[var(--role-border)]">
                      <td className="p-3">TOTAL</td>
                      <td className="p-3 text-right">{formatMoney(trialBalanceTotals.budget)}</td>
                      <td className="p-3 text-right">{formatMoney(trialBalanceTotals.actual)}</td>
                      <td className="p-3 text-right">{formatMoney(trialBalanceTotals.committed)}</td>
                      <td className="p-3 text-right">{formatMoney(trialBalanceTotals.remaining)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="panel lg:col-span-2">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-[var(--role-text)]">P&L by Department (Expense Variance)</h3>
              {profitLossRows.length > 0 && (
                <button
                  onClick={() => exportPLToPDF()}
                  className="btn-secondary !py-1.5 !px-3 !text-xs"
                >
                  Export PDF
                </button>
              )}
            </div>
            {!budgetMonitoringLoaded ? (
              <p className="mt-3 text-sm text-[var(--role-text)]/60">Loading P&L variance...</p>
            ) : profitLossRows.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--role-text)]/60">No variance rows to display yet.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm text-[var(--role-text)]">
                  <thead>
                    <tr className="table-header">
                      <th className="p-3 text-left">Department</th>
                      <th className="p-3 text-right">Budget</th>
                      <th className="p-3 text-right">Actual Expense</th>
                      <th className="p-3 text-right">Committed Expense</th>
                      <th className="p-3 text-right">Variance</th>
                      <th className="p-3 text-right">Variance %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profitLossRows.map((row) => (
                      <tr key={`pl-${row.department_id}-${row.department_name}`} className="table-row">
                        <td className="p-3 font-medium">{row.department_name}</td>
                        <td className="p-3 text-right">{formatMoney(row.budget)}</td>
                        <td className="p-3 text-right">{formatMoney(row.expense_actual)}</td>
                        <td className="p-3 text-right">{formatMoney(row.expense_committed)}</td>
                        <td className={`p-3 text-right font-semibold ${row.variance < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                          {formatMoney(row.variance)}
                        </td>
                        <td className={`p-3 text-right font-semibold ${row.variance_pct < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                          {row.variance_pct.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {summaryLoaded && !summary && !requestsLoaded && (
        <div className="panel text-center">
          <p className="text-xl font-semibold text-[var(--role-text)]">No report data yet</p>
          <p className="mt-2 text-[var(--role-text)]/60">Try adjusting the filters or submit a few requests first.</p>
        </div>
      )}

      {requestsLoaded && requests.length > 0 && (
        <div className="panel">
          <h2 className="text-2xl font-bold text-[var(--role-text)]">Requests Report</h2>
          <div className="table-shell mt-5 overflow-x-auto">
            <table className="w-full text-sm text-[var(--role-text)]">
              <thead>
                <tr className="table-header">
                  <th className="p-4">Request Code</th>
                  <th className="p-4">Sender</th>
                  <th className="p-4">Department</th>
                  <th className="p-4">Fiscal Year</th>
                  <th className="p-4">Category</th>
                  <th className="p-4">Item</th>
                  <th className="p-4">Amount</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Submitted</th>
                  {user?.role === 'accounting' && <th className="p-4">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {paginatedRequests.map((req) => (
                  <tr key={req.id} className="table-row">
                    <td className="p-4">{req.request_code}</td>
                    <td className="p-4">{req.users?.name || 'Unknown sender'}</td>
                    <td className="p-4">{req.departments?.name || '-'}</td>
                    <td className="p-4">{req.fiscal_year || req.departments?.fiscal_year || '-'}</td>
                    <td className="p-4">{req.category || '-'}</td>
                    <td className="p-4">{req.item_name}</td>
                    <td className="p-4">PHP {Number(req.amount).toFixed(2)}</td>
                    <td className="p-4 capitalize">{req.status.replace('_', ' ')}</td>
                    <td className="p-4">{req.submitted_at ? formatDateTime(req.submitted_at) : '-'}</td>
                    {user?.role === 'accounting' && (
                      <td className="p-4">
                        {['released', 'rejected'].includes(req.status) && (
                          <button
                            onClick={() => archiveRequest(req.id, !req.archived)}
                            className={`btn-secondary !px-3 !py-1 !text-xs ${
                              req.archived ? '!bg-green-600 hover:!bg-green-700' : '!bg-orange-600 hover:!bg-orange-700'
                            }`}
                          >
                            {req.archived ? 'Unarchive' : 'Archive'}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination />
        </div>
      )}

      {requestsLoaded && requests.length === 0 && (
        <div className="panel text-center">
          <p className="text-xl font-semibold text-[var(--role-text)]">No matching requests found</p>
          <p className="mt-2 text-[var(--role-text)]/60">The current filters did not return any requests.</p>
        </div>
      )}

      {activeTab === 'cash_advance' && (
        <>
          {agingSummary && (
            <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-4">
              <div className="panel">
                <p className="text-sm text-[var(--role-text)]/60">Total Liquidations</p>
                <p className="mt-1 text-2xl font-bold text-[var(--role-text)]">{agingSummary.total}</p>
              </div>
              <div className="panel border-l-4 border-red-500">
                <p className="text-sm text-[var(--role-text)]/60">Overdue</p>
                <p className="mt-1 text-2xl font-bold text-red-500">{agingSummary.overdue}</p>
              </div>
              <div className="panel border-l-4 border-yellow-700">
                <p className="text-sm text-[var(--role-text)]/60">Due Soon (3 days)</p>
                <p className="mt-1 text-2xl font-bold text-yellow-700">{agingSummary.due_soon}</p>
              </div>
              <div className="panel border-l-4 border-green-500">
                <p className="text-sm text-[var(--role-text)]/60">Upcoming</p>
                <p className="mt-1 text-2xl font-bold text-green-500">{agingSummary.upcoming}</p>
              </div>
            </div>
          )}

          <div className="mb-4 flex gap-2">
            <button
              onClick={() => setAgingType('all')}
              className={`px-3 py-1 rounded text-sm transition-colors ${agingType === 'all' ? 'bg-[var(--role-primary)] text-[var(--role-text-inverse)]' : 'bg-[var(--role-accent)] text-[var(--role-text)]/70 hover:bg-[var(--role-accent)]/80'}`}
            >
              All
            </button>
            <button
              onClick={() => setAgingType('overdue')}
              className={`px-3 py-1 rounded text-sm transition-colors ${agingType === 'overdue' ? 'bg-red-600 text-white' : 'bg-[var(--role-accent)] text-[var(--role-text)]/70 hover:bg-[var(--role-accent)]/80'}`}
            >
              Overdue
            </button>
            <button
              onClick={() => setAgingType('due_soon')}
              className={`px-3 py-1 rounded text-sm transition-colors ${agingType === 'due_soon' ? 'bg-yellow-600 text-white' : 'bg-[var(--role-accent)] text-[var(--role-text)]/70 hover:bg-[var(--role-accent)]/80'}`}
            >
              Due Soon
            </button>
          </div>

          <div className="panel">
            <h2 className="text-2xl font-bold text-[var(--role-text)]">Cash Advance Aging Report</h2>
            {agingLoaded && cashAdvanceAging.length > 0 && (
              <div className="table-shell mt-5 overflow-x-auto">
                <table className="w-full text-sm text-[var(--role-text)]">
                  <thead>
                    <tr className="table-header">
                      <th className="p-4">Liquidation No.</th>
                      <th className="p-4">Request Code</th>
                      <th className="p-4">Employee</th>
                      <th className="p-4">Item</th>
                      <th className="p-4">Amount</th>
                      <th className="p-4">Due Date</th>
                      <th className="p-4">Status</th>
                      <th className="p-4">Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cashAdvanceAging
                      .filter(item => agingType === 'all' || item.aging_status === agingType)
                      .map((item) => (
                      <tr key={item.id} className="table-row">
                        <td className="p-4">{item.liquidation_no}</td>
                        <td className="p-4">{item.request_code}</td>
                        <td className="p-4">{item.employee_name}</td>
                        <td className="p-4">{item.item_name}</td>
                        <td className="p-4">PHP {Number(item.amount).toFixed(2)}</td>
                        <td className="p-4">{item.due_at ? formatDateTime(item.due_at) : '-'}</td>
                        <td className="p-4">
                          <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                            item.aging_status === 'overdue' ? 'bg-red-500/20 text-red-600' :
                            item.aging_status === 'due_soon' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-green-100 text-green-800'
                          }`}>
                            {item.aging_status === 'overdue' ? `Overdue (${item.days_overdue}d)` :
                             item.aging_status === 'due_soon' ? 'Due Soon' : 'Upcoming'}
                          </span>
                        </td>
                        <td className="p-4">
                          {item.aging_status === 'overdue' ? (
                            <span className="text-red-600 font-medium">{item.days_overdue} days overdue</span>
                          ) : (
                            <span className="text-[var(--role-text)]/70">{item.days_until_due} days</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {agingLoaded && cashAdvanceAging.filter(item => agingType === 'all' || item.aging_status === agingType).length === 0 && (
              <div className="mt-6 text-center">
                <p className="text-lg text-[var(--role-text)]/60">No liquidations in this category</p>
              </div>
            )}
          </div>
        </>
      )}
      
      {/* Archive Confirmation Modal */}
      {archiveConfirm.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="panel w-full max-w-md">
            <h3 className="text-xl font-bold text-[var(--role-text)] mb-4">
              {archiveConfirm.archived ? 'Archive Request?' : 'Unarchive Request?'}
            </h3>
            <p className="text-[var(--role-text)]/80 mb-6">
              {archiveConfirm.archived 
                ? 'Are you sure you want to archive this request? Archived requests are hidden from default views but can still be accessed.'
                : 'Are you sure you want to unarchive this request? It will reappear in default views.'}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setArchiveConfirm({ isOpen: false, requestId: '', archived: false })}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={confirmArchive}
                className={archiveConfirm.archived ? 'btn-danger' : 'btn-success'}
              >
                {archiveConfirm.archived ? 'Archive' : 'Unarchive'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Reports;
