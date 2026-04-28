import { useEffect, useState } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts';

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
      doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 30);
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
          req.submitted_at ? new Date(req.submitted_at).toLocaleDateString() : '-'
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

  const formatMoney = (value: number) =>
    new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      minimumFractionDigits: 2
    }).format(value);

  const chartColors = ['#31487A', '#8FB3E2', '#D9E1F1', '#4F46E5', '#059669'];

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

  const archiveRequest = async (requestId: string, archived: boolean) => {
    try {
      await api.patch(`/api/requests/${requestId}/archive`, { archived }, { headers: getAuthHeaders() });
      toast.success(`Request ${archived ? 'archived' : 'unarchived'} successfully!`);
      // Refresh the requests data
      void fetchRequests();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Archive operation failed');
    }
  };

  return (
    <div className="text-white">
      <div className="page-header">
        <h1 className="page-title">Reports</h1>
        <p className="page-subtitle">Filter expense activity, generate summaries, and export clean reports for management review.</p>
      </div>

      <div className="mb-6 flex gap-2">
        <button
          onClick={() => setActiveTab('requests')}
          className={`px-4 py-2 rounded-lg font-medium transition-all ${
            activeTab === 'requests'
              ? 'bg-gradient-to-r from-[#31487A] to-[#8FB3E2] text-white shadow-lg'
              : 'bg-white/10 text-white/70 hover:bg-white/20'
          }`}
        >
          Request Reports
        </button>
        <button
          onClick={() => setActiveTab('cash_advance')}
          className={`px-4 py-2 rounded-lg font-medium transition-all ${
            activeTab === 'cash_advance'
              ? 'bg-gradient-to-r from-[#31487A] to-[#8FB3E2] text-white shadow-lg'
              : 'bg-white/10 text-white/70 hover:bg-white/20'
          }`}
        >
          Cash Advance Aging
        </button>
      </div>

      {activeTab === 'requests' && (
      <div className="panel mb-6">
        <h2 className="text-2xl font-bold text-white">Filters</h2>
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
        <div className="mt-5 flex flex-wrap gap-3">
          <button onClick={fetchSummary} className="btn-primary">Generate Summary</button>
          <button onClick={fetchRequests} className="btn-secondary">View Requests</button>
          <button onClick={() => exportReport('pdf')} className="btn-secondary">Export PDF</button>
          <button onClick={() => exportReport('excel')} className="btn-secondary">Export Excel</button>
        </div>
      </div>
      )}

      {summary && (
        <div className="panel mb-6">
          <h2 className="text-2xl font-bold text-white">Summary Report</h2>
          <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="panel-muted text-center">
              <p className="text-3xl font-bold text-white">{summary.total_requests}</p>
              <p className="mt-2 text-[#D9E1F1]/78">Total Requests</p>
            </div>
            <div className="panel-muted text-center">
              <p className="text-3xl font-bold text-[#8FB3E2]">{summary.approved}</p>
              <p className="mt-2 text-[#D9E1F1]/78">Approved</p>
            </div>
            <div className="panel-muted text-center">
              <p className="text-3xl font-bold text-[#D9E1F1]">{summary.rejected}</p>
              <p className="mt-2 text-[#D9E1F1]/78">Rejected</p>
            </div>
            <div className="panel-muted text-center">
              <p className="text-3xl font-bold text-white">PHP {summary.total_amount.toFixed(2)}</p>
              <p className="mt-2 text-[#D9E1F1]/78">Total Amount</p>
            </div>
          </div>
        </div>
      )}

      {summary && requests.length > 0 && (
        <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="panel">
            <h3 className="text-lg font-bold text-white">Requests by Status</h3>
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
                  <Tooltip formatter={(value: any) => [value, 'Requests']} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel">
            <h3 className="text-lg font-bold text-white">Monthly Spending Trend</h3>
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthlyChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#8FB3E220" />
                  <XAxis dataKey="month" stroke="#8FB3E2" fontSize={12} />
                  <YAxis stroke="#8FB3E2" fontSize={12} tickFormatter={(v: number) => `₱${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(value: any) => [formatMoney(Number(value)), 'Amount']} />
                  <Line type="monotone" dataKey="amount" stroke="#8FB3E2" strokeWidth={3} dot={{ fill: '#8FB3E2' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel">
            <h3 className="text-lg font-bold text-white">Requests by Category</h3>
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryChartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#8FB3E220" />
                  <XAxis type="number" stroke="#8FB3E2" fontSize={12} />
                  <YAxis dataKey="name" type="category" stroke="#8FB3E2" fontSize={10} width={100} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#31487A" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel">
            <h3 className="text-lg font-bold text-white">Department Budget Overview</h3>
            <div className="mt-4 space-y-3">
              {filterOptions.departments.slice(0, 5).map((dept) => {
                const deptRequests = requests.filter(r => r.department_id === dept.id);
                const totalAmount = deptRequests.reduce((sum, r) => sum + Number(r.amount), 0);
                return (
                  <div key={dept.id} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-white">{dept.name}</span>
                      <span className="text-[#8FB3E2]">{deptRequests.length} requests</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/10">
                      <div 
                        className="h-full rounded-full bg-gradient-to-r from-[#31487A] to-[#8FB3E2]"
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

      {summaryLoaded && summary && summary.total_requests === 0 && (
        <div className="panel mb-6 text-center">
          <p className="text-xl font-semibold text-white">No report data yet</p>
          <p className="mt-2 text-[#D9E1F1]/78">Try adjusting the filters or submit a few requests first.</p>
        </div>
      )}

      {requests.length > 0 && (
        <div className="panel">
          <h2 className="text-2xl font-bold text-white">Requests Report</h2>
          <div className="table-shell mt-5 overflow-x-auto">
            <table className="w-full text-sm text-[#D9E1F1]">
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
                {requests.map((req) => (
                  <tr key={req.id} className="table-row">
                    <td className="p-4">{req.request_code}</td>
                    <td className="p-4">{req.users?.name || 'Unknown sender'}</td>
                    <td className="p-4">{req.departments?.name || '-'}</td>
                    <td className="p-4">{req.fiscal_year || req.departments?.fiscal_year || '-'}</td>
                    <td className="p-4">{req.category || '-'}</td>
                    <td className="p-4">{req.item_name}</td>
                    <td className="p-4">PHP {Number(req.amount).toFixed(2)}</td>
                    <td className="p-4 capitalize">{req.status.replace('_', ' ')}</td>
                    <td className="p-4">{req.submitted_at ? new Date(req.submitted_at).toLocaleDateString() : '-'}</td>
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
        </div>
      )}

      {requestsLoaded && requests.length === 0 && (
        <div className="panel text-center">
          <p className="text-xl font-semibold text-white">No matching requests found</p>
          <p className="mt-2 text-[#D9E1F1]/78">The current filters did not return any requests.</p>
        </div>
      )}

      {activeTab === 'cash_advance' && (
        <>
          {agingSummary && (
            <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-4">
              <div className="panel">
                <p className="text-sm text-[#D9E1F1]/78">Total Liquidations</p>
                <p className="mt-1 text-2xl font-bold text-white">{agingSummary.total}</p>
              </div>
              <div className="panel border-l-4 border-red-500">
                <p className="text-sm text-[#D9E1F1]/78">Overdue</p>
                <p className="mt-1 text-2xl font-bold text-red-400">{agingSummary.overdue}</p>
              </div>
              <div className="panel border-l-4 border-yellow-500">
                <p className="text-sm text-[#D9E1F1]/78">Due Soon (3 days)</p>
                <p className="mt-1 text-2xl font-bold text-yellow-400">{agingSummary.due_soon}</p>
              </div>
              <div className="panel border-l-4 border-green-500">
                <p className="text-sm text-[#D9E1F1]/78">Upcoming</p>
                <p className="mt-1 text-2xl font-bold text-green-400">{agingSummary.upcoming}</p>
              </div>
            </div>
          )}

          <div className="mb-4 flex gap-2">
            <button
              onClick={() => setAgingType('all')}
              className={`px-3 py-1 rounded text-sm ${agingType === 'all' ? 'bg-[#31487A] text-white' : 'bg-white/10 text-white/70'}`}
            >
              All
            </button>
            <button
              onClick={() => setAgingType('overdue')}
              className={`px-3 py-1 rounded text-sm ${agingType === 'overdue' ? 'bg-red-600 text-white' : 'bg-white/10 text-white/70'}`}
            >
              Overdue
            </button>
            <button
              onClick={() => setAgingType('due_soon')}
              className={`px-3 py-1 rounded text-sm ${agingType === 'due_soon' ? 'bg-yellow-600 text-white' : 'bg-white/10 text-white/70'}`}
            >
              Due Soon
            </button>
          </div>

          <div className="panel">
            <h2 className="text-2xl font-bold text-white">Cash Advance Aging Report</h2>
            {agingLoaded && cashAdvanceAging.length > 0 && (
              <div className="table-shell mt-5 overflow-x-auto">
                <table className="w-full text-sm text-[#D9E1F1]">
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
                        <td className="p-4">{item.due_at ? new Date(item.due_at).toLocaleDateString() : '-'}</td>
                        <td className="p-4">
                          <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                            item.aging_status === 'overdue' ? 'bg-red-500/20 text-red-400' :
                            item.aging_status === 'due_soon' ? 'bg-yellow-500/20 text-yellow-400' :
                            'bg-green-500/20 text-green-400'
                          }`}>
                            {item.aging_status === 'overdue' ? `Overdue (${item.days_overdue}d)` :
                             item.aging_status === 'due_soon' ? 'Due Soon' : 'Upcoming'}
                          </span>
                        </td>
                        <td className="p-4">
                          {item.aging_status === 'overdue' ? (
                            <span className="text-red-400">{item.days_overdue} days overdue</span>
                          ) : (
                            <span>{item.days_until_due} days</span>
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
                <p className="text-lg text-[#D9E1F1]/78">No liquidations in this category</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default Reports;
