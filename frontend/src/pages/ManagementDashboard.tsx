import { useEffect, useMemo, useState, useRef } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  AreaChart, Area
} from 'recharts';
import { formatMoney, formatPercent, toNumber } from '../utils/format';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';

const ManagementDashboard = () => {
  const [user, setUser] = useState<any>(null);
  const [departments, setDepartments] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [fiscalYear, setFiscalYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  
  const dashboardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      api.get('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
        .then(res => setUser(res.data))
        .catch(() => toast.error('Failed to load user data'));
    }
  }, []);

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

  const alerts = useMemo(() => {
    return filteredDepts
      .map(d => {
        const util = toNumber(d.annual_budget) > 0 ? (toNumber(d.used_budget) / toNumber(d.annual_budget)) * 100 : 0;
        return { ...d, utilization: util };
      })
      .filter(d => d.utilization >= 80)
      .sort((a, b) => b.utilization - a.utilization);
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

  const exportPDF = async () => {
    if (!dashboardRef.current) return;
    
    const toastId = toast.loading('Generating Executive PDF Report...');
    
    try {
      const doc = new jsPDF('p', 'mm', 'a4');
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      let currentPage = 1;
      
      // Helper function for footer
      const addFooter = () => {
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text(`Madison88 Budget Management System | Page ${currentPage}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
        doc.text(`Generated: ${new Date().toLocaleString()} | FY ${fiscalYear}`, pageWidth / 2, pageHeight - 6, { align: 'center' });
      };
      
      // Header with branding
      doc.setFillColor(30, 43, 74);
      doc.rect(0, 0, pageWidth, 45, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(10);
      doc.text('MADISON88', 14, 12);
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text('EXECUTIVE BUDGET REPORT', pageWidth / 2, 28, { align: 'center' });
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text(`Fiscal Year ${fiscalYear} | Management Control Dashboard`, pageWidth / 2, 36, { align: 'center' });
      addFooter();
      
      // Executive Summary Section
      doc.setTextColor(30, 43, 74);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('EXECUTIVE SUMMARY', 14, 60);
      
      // Budget Health Status
      const getHealthStatus = () => {
        if (stats.utilization > 90) return { text: 'CRITICAL', color: [239, 68, 68] };
        if (stats.utilization > 75) return { text: 'ELEVATED', color: [245, 158, 11] };
        return { text: 'HEALTHY', color: [16, 185, 129] };
      };
      const health = getHealthStatus();
      
      autoTable(doc, {
        startY: 65,
        head: [['Key Metric', 'Value', 'Status']],
        body: [
          ['Total Budget Pool', formatMoney(stats.totalBudget), '✓ Active'],
          ['Actual Expenses', formatMoney(stats.totalSpent), 'Recorded'],
          ['Available Cash Balance', formatMoney(stats.remaining), health.text],
          ['Overall Utilization', formatPercent(stats.utilization), `${stats.utilization.toFixed(1)}% Used`],
          ['Departments Tracked', `${filteredDepts.length}`, 'Active'],
          ['Avg. Dept Utilization', formatPercent(stats.utilization), 'System-wide']
        ],
        theme: 'striped',
        headStyles: { fillColor: [49, 72, 122], textColor: 255 },
        columnStyles: {
          0: { fontStyle: 'bold' },
          2: { fontStyle: 'bold' }
        },
        styles: { fontSize: 10 }
      });
      
      // Budget Health Indicator
      const finalY = (doc as any).lastAutoTable?.finalY || 120;
      doc.setFillColor(health.color[0], health.color[1], health.color[2]);
      doc.roundedRect(14, finalY + 5, pageWidth - 28, 20, 3, 3, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text(`BUDGET HEALTH: ${health.text}`, pageWidth / 2, finalY + 15, { align: 'center' });
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      const healthMsg = health.text === 'CRITICAL' 
        ? 'Immediate attention required - budget nearly depleted'
        : health.text === 'ELEVATED' 
        ? 'Monitor closely - approaching budget limits'
        : 'Budget utilization within normal parameters';
      doc.text(healthMsg, pageWidth / 2, finalY + 22, { align: 'center' });
      
      // Capture Charts
      const charts = dashboardRef.current.querySelectorAll('.recharts-responsive-container');
      if (charts.length >= 2) {
        // Department Chart
        const canvas1 = await html2canvas(charts[0] as HTMLElement, { backgroundColor: '#ffffff' });
        const imgData1 = canvas1.toDataURL('image/png');
        doc.addPage();
        currentPage++;
        
        doc.setFillColor(30, 43, 74);
        doc.rect(0, 0, pageWidth, 25, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('EXPENSE DISTRIBUTION BY DEPARTMENT', pageWidth / 2, 16, { align: 'center' });
        doc.addImage(imgData1, 'PNG', 10, 35, 190, 100);
        addFooter();
        
        // Monthly Chart
        const canvas2 = await html2canvas(charts[1] as HTMLElement, { backgroundColor: '#ffffff' });
        const imgData2 = canvas2.toDataURL('image/png');
        doc.text('MONTHLY CASH OUTFLOW TREND', pageWidth / 2, 155, { align: 'center' });
        doc.addImage(imgData2, 'PNG', 10, 165, 190, 100);
      }
      
      // Detailed Department Breakdown
      doc.addPage();
      currentPage++;
      
      doc.setFillColor(30, 43, 74);
      doc.rect(0, 0, pageWidth, 25, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('DETAILED DEPARTMENT BREAKDOWN', pageWidth / 2, 16, { align: 'center' });
      addFooter();
      
      // Sort departments by utilization for better insights
      const sortedDepts = [...filteredDepts].sort((a, b) => {
        const utilA = (toNumber(a.used_budget) / toNumber(a.annual_budget)) * 100;
        const utilB = (toNumber(b.used_budget) / toNumber(b.annual_budget)) * 100;
        return utilB - utilA;
      });
      
      autoTable(doc, {
        startY: 35,
        head: [['Department', 'Annual Budget', 'Spent', 'Remaining', 'Utilization', 'Status']],
        body: sortedDepts.map(d => {
          const util = (toNumber(d.used_budget) / toNumber(d.annual_budget)) * 100;
          let status = 'Healthy';
          if (util > 90) { status = 'Critical'; }
          else if (util > 75) { status = 'Warning'; }
          
          return [
            d.name,
            formatMoney(toNumber(d.annual_budget)),
            formatMoney(toNumber(d.used_budget)),
            formatMoney(toNumber(d.annual_budget) - toNumber(d.used_budget)),
            util.toFixed(1) + '%',
            status
          ];
        }),
        headStyles: { fillColor: [49, 72, 122], textColor: 255, fontStyle: 'bold' },
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 40 },
          5: { fontStyle: 'bold' }
        },
        styles: { fontSize: 9, cellPadding: 3 },
        alternateRowStyles: { fillColor: [249, 250, 251] },
        didParseCell: (data: any) => {
          if (data.column.index === 5 && data.row.index > 0) {
            const status = data.cell.raw;
            if (status === 'Critical') data.cell.styles.textColor = [239, 68, 68];
            else if (status === 'Warning') data.cell.styles.textColor = [245, 158, 11];
            else data.cell.styles.textColor = [16, 185, 129];
          }
        }
      });
      
      // Key Insights Page
      doc.addPage();
      currentPage++;
      
      doc.setFillColor(30, 43, 74);
      doc.rect(0, 0, pageWidth, 25, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('KEY INSIGHTS & RECOMMENDATIONS', pageWidth / 2, 16, { align: 'center' });
      addFooter();
      
      // Calculate insights
      const highUtilDepts = sortedDepts.filter(d => (toNumber(d.used_budget) / toNumber(d.annual_budget)) * 100 > 75);
      const criticalDepts = sortedDepts.filter(d => (toNumber(d.used_budget) / toNumber(d.annual_budget)) * 100 > 90);
      const avgUtil = stats.utilization;
      
      doc.setTextColor(30, 43, 74);
      doc.setFontSize(11);
      doc.text('TOP FINDINGS:', 14, 40);
      
      const insights = [
        `• ${criticalDepts.length} department(s) in critical budget status (>90% utilized)`,
        `• ${highUtilDepts.length} department(s) require monitoring (>75% utilized)`,
        `• Overall system utilization at ${avgUtil.toFixed(1)}%`,
        `• Available budget: ${formatMoney(stats.remaining)} across ${filteredDepts.length} departments`,
        criticalDepts.length > 0 
          ? `• URGENT: ${criticalDepts[0]?.name} requires immediate budget review`
          : '• All departments within acceptable budget parameters'
      ];
      
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      let yPos = 50;
      insights.forEach(insight => {
        doc.text(insight, 20, yPos);
        yPos += 8;
      });
      
      // Recommendations
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text('RECOMMENDATIONS:', 14, yPos + 10);
      
      const recommendations = [
        '• Review and potentially adjust budgets for high-utilization departments',
        '• Implement stricter approval workflows for departments >75% utilization',
        '• Consider budget reallocation from low-utilization to high-demand areas',
        '• Schedule monthly budget review meetings for critical departments',
        '• Enable automated alerts at 80% budget threshold'
      ];
      
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      yPos += 20;
      recommendations.forEach(rec => {
        doc.text(rec, 20, yPos);
        yPos += 8;
      });
      
      // Document metadata
      doc.setProperties({
        title: `Executive Budget Report FY${fiscalYear}`,
        subject: 'Management Control Dashboard',
        author: 'Madison88 BMS',
        keywords: 'budget, management, report, fiscal',
        creator: 'Madison88 Budget Management System'
      });
      
      doc.save(`Executive_Report_FY${fiscalYear}_${new Date().toISOString().slice(0,10)}.pdf`);
      toast.success('Executive PDF Report downloaded!', { id: toastId });
    } catch (err) {
      console.error(err);
      toast.error('Failed to generate PDF report', { id: toastId });
    }
  };

  // Access control: only management, admin, and super_admin can access
  if (user && !['management', 'admin', 'super_admin'].includes(user.role)) {
    return (
      <div className="panel text-center py-12">
        <p className="text-[var(--role-text)]/60">This page is only accessible to Management and Admin users.</p>
      </div>
    );
  }

  if (loading) return <div className="p-8 text-center">Loading Management Dashboard...</div>;

  return (
    <div className="space-y-8" ref={dashboardRef}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[var(--role-text)]">Management Control</h1>
          <p className="text-[var(--role-text)]/60 text-sm mt-1">Full visibility into department expenses and cash flow nating ginagawa.</p>
        </div>
        <div className="flex items-center gap-3 no-print">
          <select 
            value={fiscalYear} 
            onChange={(e) => setFiscalYear(Number(e.target.value))}
            className="field-input !w-40"
          >
            {[...new Set(departments.map(d => d.fiscal_year))].sort((a,b) => b-a).map(year => (
              <option key={year} value={year}>FY {year}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <button onClick={exportCSV} className="btn-secondary !py-2 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              CSV
            </button>
            <button onClick={exportPDF} className="btn-primary !py-2 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              Export PDF
            </button>
          </div>
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="rounded-[24px] border border-red-500/20 bg-red-500/5 p-6 animate-in fade-in slide-in-from-top-4 duration-500">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-red-500 text-white shadow-lg shadow-red-500/20">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-red-700">Budget Threshold Alerts</h2>
              <p className="text-sm text-red-600/80 font-medium">The following departments have utilized more than 80% of their annual budget.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {alerts.map(dept => (
              <div key={dept.id} className="bg-white rounded-xl p-4 border border-red-200 shadow-sm">
                <div className="flex justify-between items-start">
                  <span className="font-bold text-gray-800">{dept.name}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${dept.utilization >= 100 ? 'bg-red-600 text-white' : 'bg-red-100 text-red-700'}`}>
                    {dept.utilization >= 100 ? 'Depleted' : 'Critical'}
                  </span>
                </div>
                <div className="mt-3">
                  <div className="flex justify-between text-xs mb-1 font-bold">
                    <span className="text-gray-500">Utilization</span>
                    <span className="text-red-600">{dept.utilization.toFixed(1)}%</span>
                  </div>
                  <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-red-500"
                      style={{ width: `${Math.min(100, dept.utilization)}%` }}
                    />
                  </div>
                </div>
                <p className="mt-3 text-[11px] text-gray-500">
                  Remaining: <span className="font-bold text-gray-700">{formatMoney(toNumber(dept.annual_budget) - toNumber(dept.used_budget))}</span>
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

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
