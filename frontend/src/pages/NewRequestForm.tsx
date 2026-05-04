import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api';
import toast from 'react-hot-toast';
import { formatMoney } from '../utils/format';

type RequestType = 'reimbursement' | 'cash_advance' | 'liquidation';

interface Category {
  id: string;
  category_code: string;
  category_name: string;
  budget_amount?: number;
  remaining_amount?: number;
}

interface CostCenter {
  id: string;
  cost_center_code: string;
  cost_center_name: string;
}

interface CashAdvance {
  id: string;
  advance_code: string;
  amount_issued: number;
  balance: number;
  purpose: string;
}

interface LiquidationItem {
  expense_date: string;
  category_id: string;
  description: string;
  amount: number;
  receipt_attached: boolean;
}

const NewRequestForm = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialType = (searchParams.get('type') as RequestType) || 'reimbursement';
  const initialAdvanceId = searchParams.get('advance_id');

  const [activeTab, setActiveTab] = useState<RequestType>(initialType);
  const [user, setUser] = useState<any>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [cashAdvances, setCashAdvances] = useState<CashAdvance[]>([]);
  const [selectedAdvance, setSelectedAdvance] = useState<CashAdvance | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Reimbursement Form
  const [reimbursementForm, setReimbursementForm] = useState({
    expense_date: new Date().toISOString().split('T')[0],
    category_id: '',
    item_name: '',
    amount: '',
    cost_center_id: '',
    project: '',
    business_purpose: '',
    receipt_file: null as File | null
  });

  // Cash Advance Form
  const [cashAdvanceForm, setCashAdvanceForm] = useState({
    advance_type: 'Travel',
    amount: '',
    expected_use_date: '',
    expected_liquidation_date: '',
    purpose: '',
    cost_center_id: '',
    breakdown: [
      { item: 'Transportation', amount: '' },
      { item: 'Meals', amount: '' },
      { item: 'Miscellaneous', amount: '' }
    ]
  });

  // Liquidation Form
  const [liquidationForm, setLiquidationForm] = useState<{
    advance_id: string;
    items: LiquidationItem[];
  }>({
    advance_id: initialAdvanceId || '',
    items: []
  });

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/login');
      return;
    }

    const loadData = async () => {
      try {
        // First get user data
        const userRes = await api.get('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
        const userData = userRes.data;
        setUser(userData);

        // Fetch categories and cost centers (filtered by user's department)
        const [categoriesRes, costCentersRes] = await Promise.all([
          api.get(`/api/budget/categories?department_id=${userData.department_id || ''}`, { headers: { Authorization: `Bearer ${token}` } }),
          api.get(`/api/budget/cost-centers?department_id=${userData.department_id || ''}`, { headers: { Authorization: `Bearer ${token}` } })
        ]);

        // Only show categories that belong to the user's department
        setCategories(categoriesRes.data || []);
        setCostCenters(costCentersRes.data || []);

        // Load cash advances for liquidation
        const advancesRes = await api.get(`/api/cash-advances/for-liquidation/${userRes.data.id}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setCashAdvances(advancesRes.data || []);

        // If initial advance_id provided, select it
        if (initialAdvanceId) {
          const advance = advancesRes.data?.find((a: CashAdvance) => a.id === initialAdvanceId);
          if (advance) {
            setSelectedAdvance(advance);
            setLiquidationForm(prev => ({ ...prev, advance_id: advance.id }));
            // Add initial empty item
            setLiquidationForm(prev => ({
              ...prev,
              items: [{
                expense_date: new Date().toISOString().split('T')[0],
                category_id: '',
                description: '',
                amount: 0,
                receipt_attached: false
              }]
            }));
          }
        }
      } catch (err) {
        toast.error('Failed to load form data');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [navigate, initialAdvanceId]);

  // Tab change handler
  useEffect(() => {
    // Reset forms when switching tabs
    if (activeTab === 'reimbursement') {
      setReimbursementForm({
        expense_date: new Date().toISOString().split('T')[0],
        category_id: '',
        item_name: '',
        amount: '',
        cost_center_id: '',
        project: '',
        business_purpose: '',
        receipt_file: null
      });
    }
  }, [activeTab]);

  const handleSubmitReimbursement = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const token = localStorage.getItem('token');

    try {
      await api.post('/api/requests', {
        request_type: 'reimbursement',
        item_name: reimbursementForm.item_name,
        category: categories.find(c => c.id === reimbursementForm.category_id)?.category_name || 'Uncategorized',
        category_id: reimbursementForm.category_id,
        amount: parseFloat(reimbursementForm.amount),
        purpose: reimbursementForm.business_purpose,
        expense_date: reimbursementForm.expense_date,
        cost_center_id: reimbursementForm.cost_center_id,
        project: reimbursementForm.project,
        priority: 'normal'
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      toast.success('Reimbursement request submitted!');
      navigate('/');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to submit request');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitCashAdvance = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const token = localStorage.getItem('token');

    const totalAmount = cashAdvanceForm.breakdown.reduce((sum, item) => sum + (parseFloat(item.amount as string) || 0), 0);

    try {
      await api.post('/api/requests', {
        request_type: 'cash_advance',
        item_name: `Cash Advance - ${cashAdvanceForm.advance_type}`,
        category: 'Cash Advance',
        amount: totalAmount,
        purpose: cashAdvanceForm.purpose,
        expected_liquidation_date: cashAdvanceForm.expected_liquidation_date,
        priority: 'normal'
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      toast.success('Cash advance request submitted!');
      navigate('/');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to submit request');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitLiquidation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAdvance) {
      toast.error('Please select a cash advance to liquidate');
      return;
    }

    setSubmitting(true);
    const token = localStorage.getItem('token');

    try {
      // Create liquidation request
      const totalLiquidated = liquidationForm.items.reduce((sum, item) => sum + item.amount, 0);
      
      await api.post('/api/requests', {
        request_type: 'liquidation',
        item_name: `Liquidation - ${selectedAdvance.advance_code}`,
        category: 'Liquidation',
        amount: totalLiquidated,
        purpose: `Liquidation for ${selectedAdvance.advance_code}`,
        original_advance_id: selectedAdvance.id,
        priority: 'normal'
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      // Add liquidation items to cash advance
      await api.post(`/api/cash-advances/${selectedAdvance.id}/liquidate`, {
        items: liquidationForm.items
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      toast.success('Liquidation submitted successfully!');
      navigate('/');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to submit liquidation');
    } finally {
      setSubmitting(false);
    }
  };

  const addLiquidationItem = () => {
    setLiquidationForm(prev => ({
      ...prev,
      items: [
        ...prev.items,
        {
          expense_date: new Date().toISOString().split('T')[0],
          category_id: '',
          description: '',
          amount: 0,
          receipt_attached: false
        }
      ]
    }));
  };

  const updateLiquidationItem = (index: number, field: keyof LiquidationItem, value: any) => {
    setLiquidationForm(prev => ({
      ...prev,
      items: prev.items.map((item, i) => i === index ? { ...item, [field]: value } : item)
    }));
  };

  const removeLiquidationItem = (index: number) => {
    setLiquidationForm(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index)
    }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="bms-spinner"></div>
      </div>
    );
  }

  const getTotalBreakdown = () => {
    return cashAdvanceForm.breakdown.reduce((sum, item) => sum + (parseFloat(item.amount as string) || 0), 0);
  };

  const getTotalLiquidated = () => {
    return liquidationForm.items.reduce((sum, item) => sum + item.amount, 0);
  };

  return (
    <div className="text-[var(--role-text)] page-transition">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">New Expense Request</h1>
        <p className="page-subtitle">Submit reimbursement, cash advance, or liquidation</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {[
          { key: 'reimbursement', label: 'Reimbursement', icon: '📄' },
          { key: 'cash_advance', label: 'Cash Advance', icon: '💵' },
          { key: 'liquidation', label: 'Liquidation', icon: '📊' }
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as RequestType)}
            className={`px-6 py-3 rounded-2xl font-medium transition-all flex items-center gap-2 ${
              activeTab === tab.key
                ? 'bg-[var(--role-primary)] text-white shadow-lg'
                : 'bg-[var(--role-surface)] border border-[var(--role-border)] text-[var(--role-text)]/70 hover:bg-[var(--role-accent)]'
            }`}
          >
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Reimbursement Form */}
      {activeTab === 'reimbursement' && (
        <form onSubmit={handleSubmitReimbursement} className="panel max-w-3xl">
          <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
            <svg className="w-6 h-6 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
            </svg>
            Submit Reimbursement
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-2">Employee</label>
              <input
                type="text"
                value={user?.name || user?.email}
                disabled
                className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Expense Date *</label>
              <input
                type="date"
                required
                value={reimbursementForm.expense_date}
                onChange={(e) => setReimbursementForm(prev => ({ ...prev, expense_date: e.target.value }))}
                className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Expense Category *</label>
            <select
              required
              value={reimbursementForm.category_id}
              onChange={(e) => setReimbursementForm(prev => ({ ...prev, category_id: e.target.value }))}
              className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
            >
              <option value="">Select category...</option>
              {categories.map(cat => (
                <option key={cat.id} value={cat.id}>
                  {cat.category_code} - {cat.category_name} ({formatMoney(cat.remaining_amount || cat.budget_amount || 0)} remaining)
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-2">Amount *</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--role-text)]/60">₱</span>
                <input
                  type="number"
                  required
                  min="0.01"
                  step="0.01"
                  value={reimbursementForm.amount}
                  onChange={(e) => setReimbursementForm(prev => ({ ...prev, amount: e.target.value }))}
                  className="w-full pl-8 pr-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
                  placeholder="0.00"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Department</label>
              <input
                type="text"
                value={user?.department_name || 'Not Assigned'}
                disabled
                className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-gray-100 text-[var(--role-text)]"
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Cost Center</label>
            <select
              value={reimbursementForm.cost_center_id}
              onChange={(e) => setReimbursementForm(prev => ({ ...prev, cost_center_id: e.target.value }))}
              className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
            >
              <option value="">Select cost center...</option>
              {costCenters.map(cc => (
                <option key={cc.id} value={cc.id}>{cc.cost_center_code} - {cc.cost_center_name}</option>
              ))}
            </select>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Project (Optional)</label>
            <input
              type="text"
              value={reimbursementForm.project}
              onChange={(e) => setReimbursementForm(prev => ({ ...prev, project: e.target.value }))}
              className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
              placeholder="Enter project name"
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Business Purpose *</label>
            <textarea
              required
              value={reimbursementForm.business_purpose}
              onChange={(e) => setReimbursementForm(prev => ({ ...prev, business_purpose: e.target.value }))}
              className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] min-h-[100px]"
              placeholder="Describe the business purpose..."
            />
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium mb-2">Receipt Upload</label>
            <div className="border-2 border-dashed border-[var(--role-border)] rounded-xl p-6 text-center hover:border-[var(--role-primary)]/50 transition-colors">
              <input
                type="file"
                accept="image/*,.pdf"
                onChange={(e) => setReimbursementForm(prev => ({ ...prev, receipt_file: e.target.files?.[0] || null }))}
                className="hidden"
                id="receipt-upload"
              />
              <label htmlFor="receipt-upload" className="cursor-pointer">
                <svg className="w-10 h-10 mx-auto mb-2 text-[var(--role-text)]/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-sm text-[var(--role-text)]/60">
                  {reimbursementForm.receipt_file 
                    ? `Selected: ${reimbursementForm.receipt_file.name}` 
                    : 'Click to upload receipt (image or PDF)'}
                </p>
              </label>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="btn-secondary px-8"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary px-8 flex-1"
            >
              {submitting ? 'Submitting...' : 'Submit Reimbursement'}
            </button>
          </div>
        </form>
      )}

      {/* Cash Advance Form */}
      {activeTab === 'cash_advance' && (
        <form onSubmit={handleSubmitCashAdvance} className="panel max-w-3xl">
          <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
            <svg className="w-6 h-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Request Cash Advance
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-2">Employee</label>
              <input
                type="text"
                value={user?.name || 'Loading...'}
                disabled
                className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-gray-100 text-[var(--role-text)]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Department</label>
              <input
                type="text"
                value={user?.department_name || 'Not Assigned'}
                disabled
                className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-gray-100 text-[var(--role-text)]"
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Cost Center</label>
            <select
              value={cashAdvanceForm.cost_center_id}
              onChange={(e) => setCashAdvanceForm(prev => ({ ...prev, cost_center_id: e.target.value }))}
              className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
            >
              <option value="">Select cost center...</option>
              {costCenters.map(cc => (
                <option key={cc.id} value={cc.id}>{cc.cost_center_code} - {cc.cost_center_name}</option>
              ))}
            </select>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Advance Type</label>
            <select
              value={cashAdvanceForm.advance_type}
              onChange={(e) => setCashAdvanceForm(prev => ({ ...prev, advance_type: e.target.value }))}
              className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
            >
              <option value="Travel">Travel</option>
              <option value="Project">Project</option>
              <option value="Event">Event</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-2">Expected Use Date</label>
              <input
                type="date"
                value={cashAdvanceForm.expected_use_date}
                onChange={(e) => setCashAdvanceForm(prev => ({ ...prev, expected_use_date: e.target.value }))}
                className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Expected Liquidation Date *</label>
              <input
                type="date"
                required
                value={cashAdvanceForm.expected_liquidation_date}
                onChange={(e) => setCashAdvanceForm(prev => ({ ...prev, expected_liquidation_date: e.target.value }))}
                className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
              />
            </div>
          </div>

          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium">Estimated Breakdown</label>
              <button
                type="button"
                onClick={() => {
                  setCashAdvanceForm(prev => ({
                    ...prev,
                    breakdown: [...prev.breakdown, { item: '', amount: '' }]
                  }));
                }}
                className="text-sm text-[var(--role-primary)] hover:underline flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Item
              </button>
            </div>
            <div className="space-y-3">
              {cashAdvanceForm.breakdown.map((item, index) => (
                <div key={index} className="flex items-center gap-3">
                  <span className="text-sm text-[var(--role-text)]/60">→</span>
                  <input
                    type="text"
                    value={item.item}
                    onChange={(e) => {
                      const newBreakdown = [...cashAdvanceForm.breakdown];
                      newBreakdown[index].item = e.target.value;
                      setCashAdvanceForm(prev => ({ ...prev, breakdown: newBreakdown }));
                    }}
                    placeholder="Item name (e.g., Transportation)"
                    className="flex-1 px-3 py-2 rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)] text-sm"
                  />
                  <div className="relative w-40">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--role-text)]/60">₱</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.amount}
                      onChange={(e) => {
                        const newBreakdown = [...cashAdvanceForm.breakdown];
                        newBreakdown[index].amount = e.target.value;
                        setCashAdvanceForm(prev => ({ ...prev, breakdown: newBreakdown }));
                      }}
                      className="w-full pl-7 pr-3 py-2 rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)] text-sm"
                      placeholder="0.00"
                    />
                  </div>
                  {cashAdvanceForm.breakdown.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        const newBreakdown = cashAdvanceForm.breakdown.filter((_, i) => i !== index);
                        setCashAdvanceForm(prev => ({ ...prev, breakdown: newBreakdown }));
                      }}
                      className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      title="Remove item"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-[var(--role-border)] flex justify-between items-center">
              <span className="font-medium">Total Amount:</span>
              <span className="text-xl font-bold text-emerald-600">{formatMoney(getTotalBreakdown())}</span>
            </div>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium mb-2">Purpose *</label>
            <textarea
              required
              value={cashAdvanceForm.purpose}
              onChange={(e) => setCashAdvanceForm(prev => ({ ...prev, purpose: e.target.value }))}
              className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)] min-h-[100px]"
              placeholder="Describe the purpose for this cash advance..."
            />
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="btn-secondary px-8"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary px-8 flex-1"
            >
              {submitting ? 'Submitting...' : 'Request Cash Advance'}
            </button>
          </div>
        </form>
      )}

      {/* Liquidation Form */}
      {activeTab === 'liquidation' && (
        <form onSubmit={handleSubmitLiquidation} className="panel max-w-4xl">
          <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
            <svg className="w-6 h-6 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
            Liquidate Cash Advance
          </h2>

          {/* Select Cash Advance */}
          <div className="mb-6">
            <label className="block text-sm font-medium mb-2">Select Cash Advance *</label>
            <select
              required
              value={liquidationForm.advance_id}
              onChange={(e) => {
                const advance = cashAdvances.find(a => a.id === e.target.value);
                setSelectedAdvance(advance || null);
                setLiquidationForm(prev => ({ ...prev, advance_id: e.target.value }));
              }}
              className="w-full px-4 py-3 rounded-xl border border-[var(--role-border)] bg-[var(--role-surface)]"
            >
              <option value="">Select outstanding cash advance...</option>
              {cashAdvances.map(advance => (
                <option key={advance.id} value={advance.id}>
                  {advance.advance_code} - Balance: {formatMoney(advance.balance)} - {advance.purpose}
                </option>
              ))}
            </select>
          </div>

          {selectedAdvance && (
            <div className="mb-6 p-4 rounded-xl bg-blue-50 border border-blue-200">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm text-blue-600/70">Original Advance</p>
                  <p className="text-lg font-semibold text-blue-700">{formatMoney(selectedAdvance.amount_issued)}</p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-blue-600/70">Liquidated So Far</p>
                  <p className="text-lg font-semibold text-blue-700">
                    {formatMoney(selectedAdvance.amount_issued - selectedAdvance.balance)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-blue-600/70">Remaining Balance</p>
                  <p className="text-lg font-semibold text-emerald-600">{formatMoney(selectedAdvance.balance)}</p>
                </div>
              </div>
            </div>
          )}

          {/* Line Items */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium">Expense Line Items</label>
              <button
                type="button"
                onClick={addLiquidationItem}
                className="btn-secondary text-sm flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Item
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-[var(--role-border)]">
                  <tr className="text-left text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/60">
                    <th className="pb-3 font-medium">Date</th>
                    <th className="pb-3 font-medium">Category</th>
                    <th className="pb-3 font-medium">Description</th>
                    <th className="pb-3 font-medium text-right">Amount</th>
                    <th className="pb-3 font-medium text-center">Receipt</th>
                    <th className="pb-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--role-border)]">
                  {liquidationForm.items.map((item, index) => (
                    <tr key={index}>
                      <td className="py-2">
                        <input
                          type="date"
                          value={item.expense_date}
                          onChange={(e) => updateLiquidationItem(index, 'expense_date', e.target.value)}
                          className="w-full px-2 py-2 rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)] text-sm"
                        />
                      </td>
                      <td className="py-2">
                        <select
                          value={item.category_id}
                          onChange={(e) => updateLiquidationItem(index, 'category_id', e.target.value)}
                          className="w-full px-2 py-2 rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)] text-sm"
                        >
                          <option value="">Select...</option>
                          {categories.map(cat => (
                            <option key={cat.id} value={cat.id}>{cat.category_name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2">
                        <input
                          type="text"
                          value={item.description}
                          onChange={(e) => updateLiquidationItem(index, 'description', e.target.value)}
                          className="w-full px-2 py-2 rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)] text-sm"
                          placeholder="Description"
                        />
                      </td>
                      <td className="py-2">
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--role-text)]/60 text-sm">₱</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.amount || ''}
                            onChange={(e) => updateLiquidationItem(index, 'amount', parseFloat(e.target.value) || 0)}
                            className="w-full pl-6 pr-2 py-2 rounded-lg border border-[var(--role-border)] bg-[var(--role-surface)] text-sm"
                          />
                        </div>
                      </td>
                      <td className="py-2 text-center">
                        <input
                          type="checkbox"
                          checked={item.receipt_attached}
                          onChange={(e) => updateLiquidationItem(index, 'receipt_attached', e.target.checked)}
                          className="w-5 h-5 rounded border-[var(--role-border)]"
                        />
                      </td>
                      <td className="py-2">
                        <button
                          type="button"
                          onClick={() => removeLiquidationItem(index)}
                          className="p-1 text-red-500 hover:bg-red-50 rounded transition-colors"
                        >
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {liquidationForm.items.length === 0 && (
              <div className="text-center py-6 text-[var(--role-text)]/60 border border-dashed border-[var(--role-border)] rounded-xl">
                <p>No items added yet</p>
                <button
                  type="button"
                  onClick={addLiquidationItem}
                  className="mt-2 text-[var(--role-primary)] hover:underline text-sm"
                >
                  Add your first expense item
                </button>
              </div>
            )}
          </div>

          {/* Summary */}
          {liquidationForm.items.length > 0 && selectedAdvance && (
            <div className="mb-6 p-4 rounded-xl bg-gray-50 border border-gray-200">
              <div className="flex justify-between items-center mb-2">
                <span>Total Liquidated:</span>
                <span className="font-semibold">{formatMoney(getTotalLiquidated())}</span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-gray-200">
                <span className="font-medium">Balance:</span>
                <span className={`font-bold ${getTotalLiquidated() > selectedAdvance.balance ? 'text-red-600' : 'text-emerald-600'}`}>
                  {formatMoney(selectedAdvance.balance - getTotalLiquidated())}
                  {getTotalLiquidated() > selectedAdvance.balance ? ' (Over!)' : getTotalLiquidated() < selectedAdvance.balance ? ' (To return)' : ' (Exact)'}
                </span>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="btn-secondary px-8"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !selectedAdvance || liquidationForm.items.length === 0}
              className="btn-primary px-8 flex-1"
            >
              {submitting ? 'Submitting...' : 'Submit Liquidation'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default NewRequestForm;
