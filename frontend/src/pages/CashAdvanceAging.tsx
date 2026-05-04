import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api';
import toast from 'react-hot-toast';
import { formatMoney, toNumber } from '../utils/format';

interface AgingItem {
  id: string;
  advance_code: string;
  employee_name: string;
  department_name: string;
  amount_issued: number;
  amount_liquidated: number;
  balance: number;
  issued_at: string;
  liquidation_due_at: string;
  days_open: number;
  days_overdue: number;
  aging_bucket: string;
  status: string;
  purpose: string;
}

interface AgingReport {
  total_outstanding: number;
  total_count: number;
  overdue_count: number;
  summary: {
    'Current': AgingItem[];
    '1-7 Days': AgingItem[];
    '8-14 Days': AgingItem[];
    '15-30 Days': AgingItem[];
    '30+ Days': AgingItem[];
  };
  details: AgingItem[];
}

const CashAdvanceAging = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const filterParam = searchParams.get('filter');
  
  const [report, setReport] = useState<AgingReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedBucket, setSelectedBucket] = useState<string>(filterParam === 'overdue' ? '30+ Days' : 'all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/login');
      return;
    }

    const loadReport = async () => {
      try {
        const res = await api.get('/api/cash-advances/aging', {
          headers: { Authorization: `Bearer ${token}` }
        });
        setReport(res.data);
      } catch (err: any) {
        toast.error(err.response?.data?.error || 'Failed to load aging report');
      } finally {
        setLoading(false);
      }
    };

    loadReport();
  }, [navigate]);

  const filteredItems = report?.details.filter(item => {
    const matchesBucket = selectedBucket === 'all' || item.aging_bucket === selectedBucket;
    const matchesSearch = 
      item.employee_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.advance_code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.department_name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesBucket && matchesSearch;
  }) || [];

  const buckets = [
    { key: 'all', label: 'All Outstanding', color: 'bg-gray-500' },
    { key: 'Current', label: 'Current', color: 'bg-emerald-500' },
    { key: '1-7 Days', label: '1-7 Days', color: 'bg-yellow-400' },
    { key: '8-14 Days', label: '8-14 Days', color: 'bg-amber-500' },
    { key: '15-30 Days', label: '15-30 Days', color: 'bg-orange-500' },
    { key: '30+ Days', label: '30+ Days', color: 'bg-red-500' }
  ];

  const getBucketCount = (key: string) => {
    if (key === 'all') return report?.total_count || 0;
    return report?.summary[key as keyof typeof report.summary]?.length || 0;
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
        <h1 className="page-title">Cash Advance Aging Report</h1>
        <p className="page-subtitle">Track outstanding cash advances and overdue liquidations</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="panel">
          <p className="text-sm text-[var(--role-text)]/60 mb-1">Total Outstanding</p>
          <p className="text-2xl font-bold text-[var(--role-text)]">{formatMoney(toNumber(report?.total_outstanding))}</p>
        </div>
        <div className="panel">
          <p className="text-sm text-[var(--role-text)]/60 mb-1">Total Count</p>
          <p className="text-2xl font-bold text-[var(--role-text)]">{report?.total_count || 0}</p>
        </div>
        <div className="panel border-red-200 bg-red-50/50">
          <p className="text-sm text-red-600/70 mb-1">Overdue Count</p>
          <p className="text-2xl font-bold text-red-600">{report?.overdue_count || 0}</p>
        </div>
        <div className="panel">
          <p className="text-sm text-[var(--role-text)]/60 mb-1">% Overdue</p>
          <p className="text-2xl font-bold text-[var(--role-text)]">
            {report?.total_count ? ((report.overdue_count / report.total_count) * 100).toFixed(1) : 0}%
          </p>
        </div>
      </div>

      {/* Bucket Filters */}
      <div className="panel mb-6">
        <h3 className="text-sm font-medium mb-4">Filter by Aging Bucket</h3>
        <div className="flex flex-wrap gap-2">
          {buckets.map(bucket => (
            <button
              key={bucket.key}
              onClick={() => setSelectedBucket(bucket.key)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 ${
                selectedBucket === bucket.key
                  ? 'bg-[var(--role-primary)] text-white shadow-md'
                  : 'bg-[var(--role-accent)] border border-[var(--role-border)] hover:bg-[var(--role-surface)]'
              }`}
            >
              <span className={`w-3 h-3 rounded-full ${bucket.color}`}></span>
              <span>{bucket.label}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs ${
                selectedBucket === bucket.key ? 'bg-white/20' : 'bg-[var(--role-surface)]'
              }`}>
                {getBucketCount(bucket.key)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="panel mb-6">
        <div className="relative">
          <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--role-text)]/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by employee name, advance code, or department..."
            className="w-full pl-12 pr-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
          />
        </div>
      </div>

      {/* Data Table */}
      <div className="panel">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <svg className="w-5 h-5 text-[var(--role-primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Outstanding Cash Advances
          </h2>
          <span className="text-sm text-[var(--role-text)]/60">
            Showing {filteredItems.length} of {report?.total_count || 0}
          </span>
        </div>

        {filteredItems.length === 0 ? (
          <div className="text-center py-8 text-[var(--role-text)]/60">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p>No outstanding cash advances found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-[var(--role-border)]">
                <tr className="text-left text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/60">
                  <th className="pb-3 font-medium">Employee</th>
                  <th className="pb-3 font-medium">Advance Code</th>
                  <th className="pb-3 font-medium">Department</th>
                  <th className="pb-3 font-medium text-right">Amount Issued</th>
                  <th className="pb-3 font-medium text-right">Balance</th>
                  <th className="pb-3 font-medium text-center">Days Open</th>
                  <th className="pb-3 font-medium">Aging Bucket</th>
                  <th className="pb-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--role-border)]">
                {filteredItems.map((item) => (
                  <tr key={item.id} className="hover:bg-[var(--role-accent)]/30 transition-colors">
                    <td className="py-3">
                      <p className="font-medium">{item.employee_name}</p>
                      <p className="text-xs text-[var(--role-text)]/60 truncate max-w-[200px]">{item.purpose}</p>
                    </td>
                    <td className="py-3">
                      <span className="font-medium text-sm">{item.advance_code}</span>
                    </td>
                    <td className="py-3 text-sm">{item.department_name}</td>
                    <td className="py-3 text-right">{formatMoney(item.amount_issued)}</td>
                    <td className="py-3 text-right font-medium text-emerald-600">{formatMoney(item.balance)}</td>
                    <td className="py-3 text-center">
                      <span className={`inline-flex items-center justify-center w-10 h-10 rounded-full text-sm font-medium ${
                        item.days_overdue > 0 
                          ? 'bg-red-100 text-red-700' 
                          : 'bg-gray-100 text-gray-700'
                      }`}>
                        {item.days_open}
                      </span>
                    </td>
                    <td className="py-3">
                      <span className={`inline-flex px-3 py-1 rounded-full text-xs font-medium ${
                        item.aging_bucket === 'Current' ? 'bg-emerald-100 text-emerald-700' :
                        item.aging_bucket === '1-7 Days' ? 'bg-yellow-100 text-yellow-700' :
                        item.aging_bucket === '8-14 Days' ? 'bg-amber-100 text-amber-700' :
                        item.aging_bucket === '15-30 Days' ? 'bg-orange-100 text-orange-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {item.aging_bucket}
                        {item.days_overdue > 0 && ` (${item.days_overdue} overdue)`}
                      </span>
                    </td>
                    <td className="py-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => navigate(`/cash-advances/${item.id}`)}
                          className="px-3 py-1 rounded-lg bg-[var(--role-accent)] hover:bg-[var(--role-surface)] text-sm transition-colors"
                        >
                          View
                        </button>
                        {item.balance > 0 && (
                          <button
                            onClick={() => navigate(`/requests/new?type=liquidation&advance_id=${item.id}`)}
                            className="px-3 py-1 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 text-sm transition-colors"
                          >
                            Liquidate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default CashAdvanceAging;
