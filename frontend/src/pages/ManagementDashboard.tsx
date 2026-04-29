import { useEffect, useMemo, useState } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, AreaChart, Area, Legend 
} from 'recharts';
import { formatMoney, formatPercent, toNumber } from '../utils/format';

const ManagementDashboard = () => {
  const [departments, setDepartments] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [fiscalYear, setFiscalYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    const token = localStorage.getItem('token');
    try {
      const [deptRes, reqRes] = await Promise.all([
        api.get('/api/departments', { headers: { Authorization: `Bearer ${token}` } }),
        api.get('/api/reports/requests', { headers: { Authorization: `Bearer ${token}` } })
      ]);
      setDepartments(deptRes.data || []);
      setRequests(reqRes.data || []);
    } catch (err) {
      toast.error('Failed to load management data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const filteredDepts = useMemo(() => 
    departments.filter(d => Number(d.fiscal_year) === fiscalYear),
    [departments, fiscalYear]
  );

  const stats = useMemo(() => {
    const totalBudget = filteredDepts.reduce((sum, d) => sum + toNumber(d.annual_budget), 0);
    const totalSpent = filteredDepts.reduce((sum, d) => sum + toNumber(d.used_budget), 0);
    const remaining = totalBudget - totalSpent;
    const utilization = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;

    return { totalBudget, totalSpent, remaining, utilization };
  }, [filteredDepts]);

  const deptChartData = useMemo(() => 
    filteredDepts.map(d => ({
      name: d.name,
      spent: toNumber(d.used_budget),
      budget: toNumber(d.annual_budget)
    })).sort((a, b) => b.spent - a.spent),
    [filteredDepts]
  );

  const monthlyData = useMemo(() => {
    const months: Record<string, number> = {};
    requests.forEach(req => {
      if (req.status === 'approved' || req.status === 'released') {
        const date = new Date(req.submitted_at);
        if (date.getFullYear() === fiscalYear) {
          const month = date.toLocaleString('default', { month: 'short' });
          months[month] = (months[month] || 0) + toNumber(req.amount);
        }
      }
    });

    const monthOrder = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return monthOrder.map(m => ({ month: m, amount: months[m] || 0 }));
  }, [requests, fiscalYear]);

  const COLORS = ['#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

  const exportCSV = () => {
    const headers = ['Department', 'Fiscal Year', 'Annual Budget', 'Used Budget', 'Remaining Budget', 'Utilization %'];
    const rows = filteredDepts.map(d => [
      d.name,
      d.fiscal_year,
      d.annual_budget,
      d.used_budget,
      toNumber(d.annual_budget) - toNumber(d.used_budget),
      ((toNumber(d.used_budget) / toNumber(d.annual_budget)) * 100).toFixed(2) + '%'
    ]);

    const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `department_expenses_FY${fiscalYear}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Report generated successfully!');
  };

  if (loading) return <div className="p-8 text-center">Loading Management Dashboard...</div>;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[var(--role-text)]">Management Control</h1>
          <p className="text-[var(--role-text)]/60 text-sm mt-1">Full visibility into department expenses and cash flow nating ginagawa.</p>
        </div>
        <div className="flex items-center gap-3">
          <select 
            value={fiscalYear} 
            onChange={(e) => setFiscalYear(Number(e.target.value))}
            className="field-input !w-40"
          >
            {[...new Set(departments.map(d => d.fiscal_year))].sort((a,b) => b-a).map(year => (
              <option key={year} value={year}>FY {year}</option>
            ))}
          </select>
          <button onClick={exportCSV} className="btn-primary !py-2 flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Generate CSV
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="panel !p-6 border-b-4 border-emerald-500">
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--role-text)]/40">Total FY Budget</p>
          <p className="text-3xl font-black mt-2 text-[var(--role-text)]">{formatMoney(stats.totalBudget)}</p>
          <p className="text-xs text-emerald-500 mt-2 font-bold">Allocated Funds</p>
        </div>
        <div className="panel !p-6 border-b-4 border-blue-500">
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--role-text)]/40">Total Expenses</p>
          <p className="text-3xl font-black mt-2 text-[var(--role-text)]">{formatMoney(stats.totalSpent)}</p>
          <p className="text-xs text-blue-500 mt-2 font-bold">{formatPercent(stats.utilization)} of budget used</p>
        </div>
        <div className="panel !p-6 border-b-4 border-amber-500">
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--role-text)]/40">Cash Balance</p>
          <p className="text-3xl font-black mt-2 text-[var(--role-text)]">{formatMoney(stats.remaining)}</p>
          <p className="text-xs text-amber-500 mt-2 font-bold">Available for Release</p>
        </div>
        <div className="panel !p-6 border-b-4 border-purple-500">
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--role-text)]/40">Avg. Utilization</p>
          <p className="text-3xl font-black mt-2 text-[var(--role-text)]">{formatPercent(stats.utilization)}</p>
          <p className="text-xs text-purple-500 mt-2 font-bold">Across {filteredDepts.length} Depts</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="panel">
          <h3 className="text-lg font-bold mb-6">Expense Distribution by Department</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={deptChartData} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--role-border)" />
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" width={120} fontSize={10} stroke="var(--role-text)" />
                <Tooltip 
                  formatter={(value: any) => formatMoney(value)}
                  contentStyle={{ backgroundColor: 'var(--role-surface)', borderRadius: '12px', border: '1px solid var(--role-border)' }}
                />
                <Bar dataKey="spent" fill="var(--role-primary)" radius={[0, 4, 4, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel">
          <h3 className="text-lg font-bold mb-6">Monthly Cash Outflow (FY {fiscalYear})</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthlyData}>
                <defs>
                  <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--role-primary)" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="var(--role-primary)" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--role-border)" />
                <XAxis dataKey="month" fontSize={12} stroke="var(--role-text)" />
                <YAxis fontSize={10} stroke="var(--role-text)" tickFormatter={(v) => `₱${(v/1000).toFixed(0)}k`} />
                <Tooltip 
                  formatter={(value: any) => formatMoney(value)}
                  contentStyle={{ backgroundColor: 'var(--role-surface)', borderRadius: '12px', border: '1px solid var(--role-border)' }}
                />
                <Area type="monotone" dataKey="amount" stroke="var(--role-primary)" fillOpacity={1} fill="url(#colorAmount)" strokeWidth={3} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-bold">Detailed Department Breakdown</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--role-border)]">
                <th className="py-4 px-4 text-xs font-bold uppercase tracking-widest text-[var(--role-text)]/40">Department</th>
                <th className="py-4 px-4 text-xs font-bold uppercase tracking-widest text-[var(--role-text)]/40">Annual Budget</th>
                <th className="py-4 px-4 text-xs font-bold uppercase tracking-widest text-[var(--role-text)]/40">Actual Spent</th>
                <th className="py-4 px-4 text-xs font-bold uppercase tracking-widest text-[var(--role-text)]/40">Remaining</th>
                <th className="py-4 px-4 text-xs font-bold uppercase tracking-widest text-[var(--role-text)]/40">Utilization</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--role-border)]">
              {filteredDepts.map((dept) => {
                const used = toNumber(dept.used_budget);
                const total = toNumber(dept.annual_budget);
                const remaining = total - used;
                const util = total > 0 ? (used / total) * 100 : 0;
                
                return (
                  <tr key={dept.id} className="hover:bg-[var(--role-accent)]/30 transition">
                    <td className="py-4 px-4 font-bold">{dept.name}</td>
                    <td className="py-4 px-4 font-medium">{formatMoney(total)}</td>
                    <td className="py-4 px-4 text-blue-500 font-bold">{formatMoney(used)}</td>
                    <td className={`py-4 px-4 font-bold ${remaining < 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                      {formatMoney(remaining)}
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-2 bg-[var(--role-border)] rounded-full overflow-hidden">
                          <div 
                            className={`h-full rounded-full ${util > 90 ? 'bg-red-500' : util > 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                            style={{ width: `${Math.min(100, util)}%` }}
                          />
                        </div>
                        <span className="text-xs font-bold w-12">{util.toFixed(1)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ManagementDashboard;
