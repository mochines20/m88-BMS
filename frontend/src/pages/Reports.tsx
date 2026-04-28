import { useEffect, useState } from 'react';
import api from '../api';
import toast from 'react-hot-toast';

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

  useEffect(() => {
    void fetchUser();
    void fetchFilterOptions();
    void fetchSummary();
  }, []);

  const exportReport = async (format: string) => {
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
    </div>
  );
};

export default Reports;
