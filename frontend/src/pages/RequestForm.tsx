import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { formatMoney, toNumber , getErrorMessage } from '../utils/format';

const RequestForm = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [items, setItems] = useState([{ name: '', amount: '' }]);
  const [form, setForm] = useState({
    category: '',
    purpose: '',
    priority: 'normal'
  });
  const [loading, setLoading] = useState(false);
  const [department, setDepartment] = useState<any>(null);
  const [userRole, setUserRole] = useState<string>('');
  const [categories, setCategories] = useState<any[]>([]);
  const [requestCode, setRequestCode] = useState<string>('');
  const [selectedCategoryBudget, setSelectedCategoryBudget] = useState<any>(null);

  useEffect(() => {
    const fetchData = async () => {
      const token = localStorage.getItem('token');
      if (!token) return;

      try {
        const userRes = await api.get('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
        setUserRole(userRes.data.role || '');

        let targetDeptId = userRes.data.department_id;
        let targetFiscalYear = userRes.data.fiscal_year || new Date().getFullYear();

        let req: any = null;
        // If editing, fetch existing request first to know its department/year
        if (id) {
          const reqRes = await api.get(`/api/requests/${id}`, { headers: { Authorization: `Bearer ${token}` } });
          req = reqRes.data;
          
          if (req.status !== 'returned_for_revision' && userRes.data.role !== 'admin' && userRes.data.role !== 'accounting') {
            toast.error('Only returned requests can be edited.');
            navigate('/tracker');
            return;
          }

          // Use the request's department and fiscal year for category filtering
          targetDeptId = req.department_id || targetDeptId;
          targetFiscalYear = req.fiscal_year || targetFiscalYear;

          setRequestCode(req.request_code || id.slice(0, 8));
          setItems([{ name: req.item_name, amount: String(req.amount) }]);
          const cleanPurpose = req.purpose?.split('\n\nItem Breakdown:')[0] || req.purpose || '';
          setForm({
            category: req.category,
            purpose: cleanPurpose,
            priority: req.priority
          });
        }

        if (targetDeptId) {
          const [deptRes, catRes] = await Promise.all([
            api.get('/api/departments', { headers: { Authorization: `Bearer ${token}` } }),
            api.get(`/api/budget/categories?department_id=${targetDeptId}&fiscal_year=${targetFiscalYear}`, { headers: { Authorization: `Bearer ${token}` } })
          ]);
          
          const dept = deptRes.data.find((d: any) => d.id === targetDeptId);
          setDepartment(dept);
          setCategories(catRes.data || []);
          
          // If we have a category in the form, find its budget details
          if (form.category || (id && catRes.data)) {
            const currentCat = form.category || (id ? req.category : '');
            const selected = catRes.data.find((c: any) => c.category_name === currentCat || c.category_code === currentCat);
            setSelectedCategoryBudget(selected || null);
          }
        }
      } catch (err) {
        console.error('Failed to fetch user/department data', err);
      }
    };

    fetchData();

    // Real-time subscription for budget updates
    let budgetChannel: any;
    if (supabase) {
      budgetChannel = supabase
        .channel('budget-realtime-form')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'departments' }, () => {
          fetchData();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'budget_categories' }, () => {
          fetchData();
        })
        .subscribe();
    }

    return () => {
      if (budgetChannel && supabase) {
        supabase.removeChannel(budgetChannel);
      }
    };
  }, [id, navigate]);

  const totalAmount = useMemo(() => {
    return items.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
  }, [items]);

  const budgetImpact = useMemo(() => {
    if (!department) return null;
    const currentRemaining = toNumber(department.remaining_budget || (toNumber(department.annual_budget) - toNumber(department.used_budget)));
    const nextRemaining = currentRemaining - totalAmount;
    return {
      currentRemaining,
      nextRemaining,
      isOverBudget: nextRemaining < 0
    };
  }, [department, totalAmount]);

  const addItem = () => {
    setItems([...items, { name: '', amount: '' }]);
  };

  const removeItem = (index: number) => {
    if (items.length === 1) return;
    setItems(items.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: 'name' | 'amount', value: string) => {
    const next = [...items];
    next[index][field] = value;
    setItems(next);
  };

  const [showOverBudgetConfirm, setShowOverBudgetConfirm] = useState(false);

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    if (items.some(item => !item.name || !item.amount)) {
      toast.error('Please fill in all item details');
      return;
    }

    // Check if over budget and show confirmation
    if (budgetImpact?.isOverBudget && !showOverBudgetConfirm) {
      setShowOverBudgetConfirm(true);
      return;
    }

    setLoading(true);
    const token = localStorage.getItem('token');
    
    // Combine items into a single request for compatibility with existing schema
    const combinedItemName = items.map(item => item.name).join(', ');
    const itemBreakdown = items.map(item => `${item.name}: ₱${parseFloat(item.amount).toLocaleString()}`).join('\n');
    
    const payload = {
      item_name: combinedItemName,
      department_id: department?.id,
      category: form.category,
      amount: totalAmount,
      purpose: `${form.purpose}\n\nItem Breakdown:\n${itemBreakdown}`,
      priority: form.priority
    };

    try {
      if (id) {
        // Edit / Resubmit mode - use same combined data as new request
        await api.patch(`/api/requests/${id}/resubmit`, {
          item_name: combinedItemName,
          department_id: department?.id,
          amount: totalAmount,
          category: form.category,
          priority: form.priority,
          purpose: `${form.purpose}\n\nItem Breakdown:\n${itemBreakdown}`
        }, { headers: { Authorization: `Bearer ${token}` } });

        toast.success('Request resubmitted successfully!');
        navigate('/tracker');
      } else {
        // New Request mode
        await api.post(
          '/api/requests',
          payload,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        toast.success('Bulk request submitted successfully!');
        setItems([{ name: '', amount: '' }]);
        setForm({ category: '', purpose: '', priority: 'normal' });
      }
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Submission failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="text-[var(--role-text)]">
      <div className="page-header">
        <h1 className="page-title">{id ? 'Edit & Resubmit Request' : 'New Request'}</h1>
        <p className="page-subtitle">
          {id ? `Updating request ${requestCode}...` : 'Submit your budget request. You can now add multiple items in a single ticket.'}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_340px]">
        <div className="panel">
          <div className="mb-6 flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--role-secondary)]/20 bg-[var(--role-secondary)]/10">
              <svg className="h-5 w-5 text-[var(--role-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-[var(--role-text)]">Multi-Item Request Form</h3>
              <p className="text-sm text-[var(--role-text)]/70">Add all items you need for this specific purpose.</p>
            </div>
          </div>

          {/* Role-based routing notice */}
          {(userRole === 'supervisor' || userRole === 'accounting') && !id && (
            <div className="mb-6 rounded-xl bg-blue-500/10 border border-blue-500/20 p-4">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <p className="text-sm font-bold text-blue-600">Direct to Accounting</p>
                  <p className="text-xs text-[var(--role-text)]/70 mt-1">
                    As a <strong>{userRole}</strong>, your requests will be routed <strong>directly to Accounting</strong> for review, skipping supervisor approval.
                  </p>
                </div>
              </div>
            </div>
          )}
          
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="field-label !mb-0">Request Items</label>
                <button 
                  type="button" 
                  onClick={addItem}
                  className="text-xs font-bold uppercase tracking-wider text-[var(--role-secondary)] hover:brightness-110"
                >
                  + Add Another Item
                </button>
              </div>
              
              {items.map((item, index) => (
                <div key={index} className="flex gap-3 items-start animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="flex-1">
                    <input 
                      className="field-input" 
                      placeholder="Item name (e.g. Wireless Mouse)" 
                      value={item.name} 
                      onChange={e => updateItem(index, 'name', e.target.value)} 
                      required 
                    />
                  </div>
                  <div className="w-32">
                    <input 
                      className="field-input" 
                      type="number" 
                      step="0.01" 
                      placeholder="Amount" 
                      value={item.amount} 
                      onChange={e => updateItem(index, 'amount', e.target.value)} 
                      required 
                    />
                  </div>
                  {items.length > 1 && (
                    <button 
                      type="button" 
                      onClick={() => removeItem(index)}
                      className="mt-3 text-red-500 hover:text-red-600 transition"
                    >
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="space-y-4">
              <label className="field-label">Category Selection</label>
              <select 
                className="field-input" 
                value={form.category} 
                onChange={e => {
                  setForm({...form, category: e.target.value});
                  const selected = categories.find(c => c.category_name === e.target.value);
                  setSelectedCategoryBudget(selected || null);
                }}
                required
              >
                <option value="">Select Category</option>
                {categories.map(cat => {
                  const remaining = toNumber(cat.remaining_amount);
                  const isOutOfBudget = remaining <= 0;
                  return (
                    <option key={cat.id} value={cat.category_name} disabled={isOutOfBudget && userRole === 'employee'}>
                      {cat.category_code ? `${cat.category_code} - ` : ''}{cat.category_name} 
                      {(userRole === 'admin' || userRole === 'accounting') && ` (₱${remaining.toLocaleString()} remaining)`}
                      {isOutOfBudget ? ' - OUT OF BUDGET' : ''}
                    </option>
                  );
                })}
              </select>
              
              {selectedCategoryBudget && (userRole === 'admin' || userRole === 'accounting') && (
                <div className={`rounded-xl p-4 border ${toNumber(selectedCategoryBudget.remaining_amount) >= totalAmount ? 'bg-green-500/10 border-green-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-[var(--role-text)]/50 font-bold">Budget Allocated</p>
                      <p className="mt-1 font-semibold text-[var(--role-text)]">{formatMoney(toNumber(selectedCategoryBudget.budget_amount))}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-[var(--role-text)]/50 font-bold">Already Used</p>
                      <p className="mt-1 font-semibold text-[var(--role-text)]">{formatMoney(toNumber(selectedCategoryBudget.used_amount))}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-[var(--role-text)]/50 font-bold">Available</p>
                      <p className={`mt-1 font-semibold ${toNumber(selectedCategoryBudget.remaining_amount) >= totalAmount ? 'text-green-600' : 'text-red-600'}`}>
                        {formatMoney(toNumber(selectedCategoryBudget.remaining_amount))}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-[var(--role-text)]/50 font-bold">Your Request</p>
                      <p className={`mt-1 font-semibold ${toNumber(selectedCategoryBudget.remaining_amount) >= totalAmount ? 'text-green-600' : 'text-red-600'}`}>
                        {formatMoney(totalAmount)}
                      </p>
                    </div>
                  </div>
                  {toNumber(selectedCategoryBudget.remaining_amount) < totalAmount && (
                    <div className="mt-3 flex items-start gap-2 bg-red-500/20 border border-red-500/30 rounded-lg p-2">
                      <svg className="w-4 h-4 text-red-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4v2m0 0a9 9 0 110-18 9 9 0 010 18z" />
                      </svg>
                      <p className="text-xs text-red-600 font-semibold">
                        ⚠️ Insufficient budget in category. You need {formatMoney(totalAmount - toNumber(selectedCategoryBudget.remaining_amount))} more.
                      </p>
                    </div>
                  )}
                </div>
              )}
              
              <div className="rounded-xl bg-[var(--role-accent)]/50 p-3 border border-dashed border-[var(--role-secondary)]/20">
                <p className="text-[10px] uppercase tracking-widest text-[var(--role-text)]/50 font-bold">Current Selection</p>
                <p className="mt-1 text-sm font-semibold text-[var(--role-secondary)]">
                  {form.category || 'Please select a category above'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div>
                <label className="field-label">Priority</label>
                <select className="field-input" value={form.priority} onChange={e => setForm({...form, priority: e.target.value})}>
                  <option value="low">Low - Routine needs</option>
                  <option value="normal">Normal - Standard timeline</option>
                  <option value="urgent">Urgent - Immediate action required</option>
                </select>
              </div>
            </div>

            <div>
              <label className="field-label">Purpose/Justification</label>
              <textarea className="field-input min-h-[100px]" rows={3} placeholder="Describe the overall need for these items..." value={form.purpose} onChange={e => setForm({...form, purpose: e.target.value})} />
            </div>

            <div className="rounded-2xl border border-[var(--role-secondary)]/20 bg-[var(--role-accent)] p-5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-[var(--role-text)]/70 uppercase tracking-widest">Total Request Amount</span>
                <span className="text-2xl font-bold text-[var(--role-text)]">
                  {formatMoney(totalAmount)}
                </span>
              </div>
              
              {budgetImpact && (
                <div className="mt-4 pt-4 border-t border-[var(--role-secondary)]/10 space-y-3">
                  {/* Budget Overview */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-xl bg-[var(--role-secondary)]/5 p-2">
                      <p className="text-[10px] uppercase tracking-wider text-[var(--role-text)]/50 font-bold">Annual Budget</p>
                      <p className="text-sm font-bold text-[var(--role-text)]">{formatMoney(toNumber(department.annual_budget))}</p>
                    </div>
                    <div className="rounded-xl bg-[var(--role-secondary)]/5 p-2">
                      <p className="text-[10px] uppercase tracking-wider text-[var(--role-text)]/50 font-bold">Used</p>
                      <p className="text-sm font-bold text-[var(--role-primary)]">{formatMoney(toNumber(department.annual_budget) - budgetImpact.currentRemaining)}</p>
                    </div>
                    <div className="rounded-xl bg-[var(--role-secondary)]/5 p-2">
                      <p className="text-[10px] uppercase tracking-wider text-[var(--role-text)]/50 font-bold">Remaining</p>
                      <p className={`text-sm font-bold ${budgetImpact.currentRemaining < totalAmount ? 'text-red-500' : 'text-emerald-500'}`}>{formatMoney(budgetImpact.currentRemaining)}</p>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] uppercase tracking-wider font-bold">
                      <span className="text-[var(--role-text)]/50">Budget Utilization</span>
                      <span className={budgetImpact.isOverBudget ? 'text-red-500' : 'text-[var(--role-text)]/70'}>
                        {((toNumber(department.annual_budget) - budgetImpact.currentRemaining) / toNumber(department.annual_budget) * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-2 w-full bg-[var(--role-border)]/30 rounded-full overflow-hidden">
                      <div 
                        className={`h-full transition-all duration-500 ${budgetImpact.isOverBudget ? 'bg-red-500' : 'bg-gradient-to-r from-emerald-400 to-emerald-500'}`}
                        style={{ width: `${Math.min(100, ((toNumber(department.annual_budget) - budgetImpact.currentRemaining) / (toNumber(department.annual_budget) || 1)) * 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* After Request Impact */}
                  <div className={`rounded-xl p-3 ${budgetImpact.isOverBudget ? 'bg-red-500/10 border border-red-500/20' : 'bg-emerald-500/10 border border-emerald-500/20'}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-[var(--role-text)]/70">
                        After This Request:
                      </span>
                      <span className={`text-lg font-bold ${budgetImpact.isOverBudget ? 'text-red-500' : 'text-emerald-600'}`}>
                        {formatMoney(budgetImpact.nextRemaining)}
                      </span>
                    </div>
                    {budgetImpact.isOverBudget && (
                      <div className="mt-2 flex items-start gap-2 text-[10px] text-red-500 font-bold">
                        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <span>⚠️ OVER BUDGET: This request exceeds your department's remaining budget. Supervisor approval required.</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <button 
              className={`w-full py-4 text-lg font-bold rounded-2xl transition-all ${
                budgetImpact?.isOverBudget 
                  ? 'bg-red-500 hover:bg-red-600 text-white' 
                  : 'btn-primary'
              }`} 
              type="submit" 
              disabled={loading}
            >
              {loading ? 'Submitting Request...' : budgetImpact?.isOverBudget ? `⚠️ Submit Over-Budget Request (${formatMoney(totalAmount)})` : `Submit Request for ${formatMoney(totalAmount)}`}
            </button>
          </form>

          {/* Over Budget Confirmation Modal */}
          {showOverBudgetConfirm && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <div 
                className="absolute inset-0 bg-black/20 backdrop-blur-sm"
                onClick={() => setShowOverBudgetConfirm(false)}
              />
              <div className="relative w-full max-w-md overflow-hidden rounded-[24px] border border-red-500/30 bg-[var(--bms-bg-1)] p-6 shadow-2xl">
                <div className="absolute inset-0 -z-10 bg-gradient-to-br from-red-500/5 via-transparent to-red-500/5" />
                <h3 className="text-xl font-bold text-red-600 mb-4">⚠️ Over Budget Warning</h3>
                
                <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-4 mb-4">
                  <p className="text-sm font-bold text-red-600 mb-3">This request exceeds your department budget</p>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-[var(--role-text)]/50 text-xs uppercase">Request Amount</p>
                      <p className="font-bold text-red-600">{formatMoney(totalAmount)}</p>
                    </div>
                    <div>
                      <p className="text-[var(--role-text)]/50 text-xs uppercase">Remaining Budget</p>
                      <p className="font-bold text-[var(--role-text)]">{formatMoney(budgetImpact?.currentRemaining || 0)}</p>
                    </div>
                    <div>
                      <p className="text-[var(--role-text)]/50 text-xs uppercase">Excess Amount</p>
                      <p className="font-bold text-red-600">{formatMoney(Math.max(0, totalAmount - (budgetImpact?.currentRemaining || 0)))}</p>
                    </div>
                    <div>
                      <p className="text-[var(--role-text)]/50 text-xs uppercase">After Approval</p>
                      <p className="font-bold text-red-600">{formatMoney(budgetImpact?.nextRemaining || 0)}</p>
                    </div>
                  </div>
                </div>
                
                <p className="text-sm text-[var(--role-text)]/80 mb-4">
                  This request will require <strong>supervisor approval</strong> due to budget constraints.
                </p>
                
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowOverBudgetConfirm(false)}
                    className="flex-1 px-4 py-3 rounded-xl border border-[var(--role-border)] text-[var(--role-text)] font-bold hover:bg-[var(--role-accent)] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      setShowOverBudgetConfirm(false);
                      // Manually trigger submission
                      setLoading(true);
                      const token = localStorage.getItem('token');
                      const combinedItemName = items.map(item => item.name).join(', ');
                      const itemBreakdown = items.map(item => `${item.name}: ₱${parseFloat(item.amount).toLocaleString()}`).join('\n');
                      const payload = {
                        item_name: combinedItemName,
                        category: form.category,
                        amount: totalAmount,
                        purpose: `${form.purpose}\n\nItem Breakdown:\n${itemBreakdown}`,
                        priority: form.priority
                      };
                      try {
                        await api.post('/api/requests', payload, { headers: { Authorization: `Bearer ${token}` } });
                        toast.success('Request submitted for supervisor approval!');
                        setItems([{ name: '', amount: '' }]);
                        setForm({ category: '', purpose: '', priority: 'normal' });
                      } catch (err: any) {
                        toast.error(getErrorMessage(err, 'Submission failed'));
                      } finally {
                        setLoading(false);
                      }
                    }}
                    className="flex-1 px-4 py-3 rounded-xl bg-red-500 text-white font-bold hover:bg-red-600 transition-colors"
                  >
                    Yes, Submit Anyway
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="panel">
            <h3 className="text-xl font-bold text-[var(--role-text)]">Bulk Request Tips</h3>
            <ul className="mt-4 space-y-4 text-sm text-[var(--role-text)]/80">
              <li className="flex gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--role-secondary)]/20 text-[10px] text-[var(--role-primary)] font-bold">1</span>
                Grouping related items (like Laptop + Mouse) makes approval faster.
              </li>
              <li className="flex gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--role-secondary)]/20 text-[10px] text-[var(--role-primary)] font-bold">2</span>
                You can add as many items as needed in one go.
              </li>
              <li className="flex gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--role-secondary)]/20 text-[10px] text-[var(--role-primary)] font-bold">3</span>
                The total amount will be automatically deducted from your department budget.
              </li>
            </ul>
          </div>

          <div className="panel-muted border-dashed">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--role-text)]/60">System Auto-Total</h3>
            <p className="mt-3 text-sm leading-relaxed text-[var(--role-text)]/70">
              Our system now automatically sums up your line items and creates a detailed breakdown for accounting review.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RequestForm;
