import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import toast from 'react-hot-toast';
import { formatMoney, toNumber } from '../utils/format';

interface BudgetSummary {
  pending_for_review: number;
  outstanding_cash_advances: number;
  overdue_liquidations: number;
  budget_utilization_pct: string;
  total_budget: number;
  total_used: number;
  total_committed: number;
  total_remaining: number;
}

interface BudgetMonitoringItem {
  category_id: string;
  category_code: string;
  category_name: string;
  department_id: string;
  department_name: string;
  budget: number;
  actual: number;
  committed: number;
  remaining: number;
  utilization_pct: string;
}

const FinanceDashboard = () => {
  const navigate = useNavigate();
  const [, setUser] = useState<any>(null);
  const [summary, setSummary] = useState<BudgetSummary | null>(null);
  const [budgetData, setBudgetData] = useState<BudgetMonitoringItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all');
  const [departments, setDepartments] = useState<any[]>([]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/login');
      return;
    }

    const loadData = async () => {
      try {
        const [userRes, summaryRes, budgetRes, deptsRes] = await Promise.all([
          api.get('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } }),
          api.get('/api/budget/summary', { headers: { Authorization: `Bearer ${token}` } }),
          api.get('/api/budget/monitoring', { headers: { Authorization: `Bearer ${token}` } }),
          api.get('/api/departments', { headers: { Authorization: `Bearer ${token}` } })
        ]);

        setUser(userRes.data);
        setSummary(summaryRes.data);
        setBudgetData(budgetRes.data || []);
        setDepartments(deptsRes.data || []);
      } catch (err: any) {
        toast.error(err.response?.data?.error || 'Failed to load dashboard');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [navigate]);

  const filteredBudgetData = selectedDepartment === 'all' 
    ? budgetData 
    : budgetData.filter(b => b.department_name === selectedDepartment);


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
        <h1 className="page-title">Finance Dashboard</h1>
        <p className="page-subtitle">Monitor budgets, cash advances, and expense approvals</p>
      </div>

      {/* Key Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {/* Pending for Review */}
        <div className="panel">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-[var(--role-text)]/60 mb-1">Pending for Review</p>
              <p className="text-3xl font-bold text-[var(--role-text)]">{summary?.pending_for_review || 0}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <button 
            onClick={() => navigate('/approvals')}
            className="mt-3 text-sm text-[var(--role-primary)] hover:underline"
          >
            Review Requests →
          </button>
        </div>

        {/* Outstanding Cash Advances */}
        <div className="panel">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-[var(--role-text)]/60 mb-1">Outstanding Cash Advances</p>
              <p className="text-3xl font-bold text-[var(--role-text)]">{formatMoney(toNumber(summary?.outstanding_cash_advances))}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <button 
            onClick={() => navigate('/cash-advance-aging')}
            className="mt-3 text-sm text-[var(--role-primary)] hover:underline"
          >
            View Aging Report →
          </button>
        </div>

        {/* Overdue Liquidations */}
        <div className="panel">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-[var(--role-text)]/60 mb-1">Overdue Liquidations</p>
              <p className="text-3xl font-bold text-red-600">{summary?.overdue_liquidations || 0}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-red-100 text-red-600 flex items-center justify-center">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
          </div>
          <button 
            onClick={() => navigate('/cash-advance-aging?filter=overdue')}
            className="mt-3 text-sm text-red-600 hover:underline"
          >
            View Overdue →
          </button>
        </div>

        {/* Budget Utilization */}
        <div className="panel">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-[var(--role-text)]/60 mb-1">Budget Utilization</p>
              <p className="text-3xl font-bold text-[var(--role-text)]">{summary?.budget_utilization_pct || 0}%</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
          </div>
          <div className="mt-3 w-full bg-gray-200 rounded-full h-2">
            <div 
              className="bg-emerald-500 h-2 rounded-full transition-all"
              style={{ width: `${Math.min(Number(summary?.budget_utilization_pct) || 0, 100)}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <button
          onClick={() => navigate('/approvals')}
          className="panel group hover:border-[var(--role-primary)]/50 transition-all duration-300 text-left"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center group-hover:scale-110 transition-transform">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-lg">Review Requests</p>
              <p className="text-sm text-[var(--role-text)]/60">Approve and release funds</p>
            </div>
          </div>
        </button>

        <button
          onClick={() => navigate('/budget-monitoring')}
          className="panel group hover:border-[var(--role-primary)]/50 transition-all duration-300 text-left"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center group-hover:scale-110 transition-transform">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-lg">Budget Monitoring</p>
              <p className="text-sm text-[var(--role-text)]/60">Track budget vs actual</p>
            </div>
          </div>
        </button>

        <button
          onClick={() => navigate('/reports')}
          className="panel group hover:border-[var(--role-primary)]/50 transition-all duration-300 text-left"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center group-hover:scale-110 transition-transform">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-lg">Reports</p>
              <p className="text-sm text-[var(--role-text)]/60">Generate financial reports</p>
            </div>
          </div>
        </button>
      </div>

      {/* Budget vs Actual Table */}
      <div className="panel">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <svg className="w-5 h-5 text-[var(--role-primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            Budget vs Actual
          </h2>
          
          <select
            value={selectedDepartment}
            onChange={(e) => setSelectedDepartment(e.target.value)}
            className="px-3 py-2 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] text-sm"
          >
            <option value="all">All Departments</option>
            {departments.map(dept => (
              <option key={dept.id} value={dept.name}>{dept.name}</option>
            ))}
          </select>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-4 mb-4 text-sm text-[var(--role-text)]/70">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-emerald-500"></span>
            <span>Actual = Paid reimbursements + liquidated</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-amber-400"></span>
            <span>Committed = Approved but not released</span>
          </div>
        </div>

        {filteredBudgetData.length === 0 ? (
          <div className="text-center py-8 text-[var(--role-text)]/60">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <p>No budget data available</p>
            <button 
              onClick={() => navigate('/budget-setup')}
              className="mt-2 text-[var(--role-primary)] hover:underline"
            >
              Set up budgets →
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-[var(--role-border)]">
                <tr className="text-left text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/60">
                  <th className="pb-3 font-medium">Category</th>
                  <th className="pb-3 font-medium">Department</th>
                  <th className="pb-3 font-medium text-right">Budget</th>
                  <th className="pb-3 font-medium text-right">Actual</th>
                  <th className="pb-3 font-medium text-right">Committed</th>
                  <th className="pb-3 font-medium text-right">Remaining</th>
                  <th className="pb-3 font-medium text-center">Utilization</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--role-border)]">
                {filteredBudgetData.map((item) => (
                  <tr key={item.category_id} className="hover:bg-[var(--role-accent)]/30 transition-colors">
                    <td className="py-3">
                      <p className="font-medium">{item.category_name}</p>
                      <p className="text-xs text-[var(--role-text)]/60">{item.category_code}</p>
                    </td>
                    <td className="py-3 text-sm">{item.department_name}</td>
                    <td className="py-3 text-right font-medium">{formatMoney(item.budget)}</td>
                    <td className="py-3 text-right text-emerald-600">{formatMoney(item.actual)}</td>
                    <td className="py-3 text-right text-amber-600">{formatMoney(item.committed)}</td>
                    <td className="py-3 text-right font-medium">{formatMoney(item.remaining)}</td>
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-200 rounded-full h-2">
                          <div 
                            className={`h-2 rounded-full transition-all ${
                              Number(item.utilization_pct) > 90 ? 'bg-red-500' : 
                              Number(item.utilization_pct) > 70 ? 'bg-amber-500' : 'bg-emerald-500'
                            }`}
                            style={{ width: `${Math.min(Number(item.utilization_pct), 100)}%` }}
                          ></div>
                        </div>
                        <span className="text-xs font-medium w-10 text-right">{item.utilization_pct}%</span>
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

export default FinanceDashboard;
