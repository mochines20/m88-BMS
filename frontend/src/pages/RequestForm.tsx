import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api';
import toast from 'react-hot-toast';
import { formatMoney, toNumber } from '../utils/format';
import { CATEGORY_STRUCTURE, MainCategory, SubCategory } from '../utils/categories';

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
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [department, setDepartment] = useState<any>(null);
  const [userRole, setUserRole] = useState<string>('');

  // Category selection states
  const [selectedMain, setSelectedMain] = useState<MainCategory | null>(null);
  const [selectedSub, setSelectedSub] = useState<string | SubCategory | null>(null);
  const [selectedItem, setSelectedItem] = useState<string>('');

  useEffect(() => {
    if (isInitialLoad && id) return; // Wait for fetch to complete if editing

    // Construct final category string
    let finalCategory = '';
    if (selectedMain) {
      finalCategory = selectedMain.name;
      if (selectedSub) {
        const subName = typeof selectedSub === 'string' ? selectedSub : selectedSub.name;
        finalCategory += ` > ${subName}`;
        if (selectedItem) {
          finalCategory += ` > ${selectedItem}`;
        }
      }
    }
    setForm(prev => ({ ...prev, category: finalCategory }));
  }, [selectedMain, selectedSub, selectedItem, id, isInitialLoad]);

  useEffect(() => {
    const fetchData = async () => {
      const token = localStorage.getItem('token');
      if (!token) return;

      try {
        const userRes = await api.get('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
        setUserRole(userRes.data.role || '');

        if (userRes.data.department_id) {
          const deptRes = await api.get('/api/departments', { headers: { Authorization: `Bearer ${token}` } });
          const userDept = deptRes.data.find((d: any) => d.id === userRes.data.department_id);
          setDepartment(userDept);
        }

        // If editing, fetch existing request
        if (id) {
          const reqRes = await api.get(`/api/requests/${id}`, { headers: { Authorization: `Bearer ${token}` } });
          const req = reqRes.data;
          
          if (req.status !== 'returned_for_revision') {
            toast.error('Only returned requests can be edited.');
            navigate('/tracker');
            return;
          }

          setItems([{ name: req.item_name, amount: String(req.amount) }]);
          // Strip out any existing item breakdown from purpose to avoid duplication
          const cleanPurpose = req.purpose?.split('\n\nItem Breakdown:')[0] || req.purpose || '';
          setForm({
            category: req.category,
            purpose: cleanPurpose,
            priority: req.priority
          });

          // Try to parse category for dropdowns
          const parts = req.category.split(' > ');
          if (parts[0]) {
            const main = CATEGORY_STRUCTURE.find(c => c.name === parts[0]);
            if (main) {
              setSelectedMain(main);
              if (parts[1]) {
                const sub = main.subcategories.find(s => (typeof s === 'string' ? s : s.name) === parts[1]);
                if (sub) {
                  setSelectedSub(sub);
                  if (parts[2]) setSelectedItem(parts[2]);
                }
              }
            }
          }
          setIsInitialLoad(false);
        }
      } catch (err) {
        console.error('Failed to fetch user/department data', err);
      }
    };

    fetchData();
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
        setSelectedMain(null);
        setSelectedSub(null);
        setSelectedItem('');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Submission failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="text-[var(--role-text)]">
      <div className="page-header">
        <h1 className="page-title">{id ? 'Edit & Resubmit Request' : 'New Request'}</h1>
        <p className="page-subtitle">
          {id ? `Updating request ${id.slice(0, 8)}...` : 'Submit your budget request. You can now add multiple items in a single ticket.'}
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
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <select 
                    className="field-input" 
                    value={selectedMain?.name || ''} 
                    onChange={e => {
                      const main = CATEGORY_STRUCTURE.find(c => c.name === e.target.value) || null;
                      setSelectedMain(main);
                      setSelectedSub(null);
                      setSelectedItem('');
                    }}
                    required
                  >
                    <option value="">Select Category</option>
                    {CATEGORY_STRUCTURE.map(main => (
                      <option key={main.name} value={main.name}>{main.name}</option>
                    ))}
                  </select>
                </div>

                {selectedMain && selectedMain.subcategories.length > 0 && (
                  <div>
                    <select 
                      className="field-input" 
                      value={typeof selectedSub === 'string' ? selectedSub : selectedSub?.name || ''} 
                      onChange={e => {
                        const sub = selectedMain.subcategories.find(s => 
                          (typeof s === 'string' ? s : s.name) === e.target.value
                        ) || null;
                        setSelectedSub(sub);
                        setSelectedItem('');
                      }}
                      required
                    >
                      <option value="">Select Sub-category</option>
                      {selectedMain.subcategories.map(sub => {
                        const name = typeof sub === 'string' ? sub : sub.name;
                        return <option key={name} value={name}>{name}</option>;
                      })}
                    </select>
                  </div>
                )}

                {selectedSub && typeof selectedSub !== 'string' && selectedSub.items && (
                  <div>
                    <select 
                      className="field-input" 
                      value={selectedItem} 
                      onChange={e => setSelectedItem(e.target.value)}
                      required
                    >
                      <option value="">Select Detail</option>
                      {selectedSub.items.map(item => {
                        const itemName = typeof item === 'string' ? item : item.name;
                        return <option key={itemName} value={itemName}>{itemName}</option>;
                      })}
                    </select>
                  </div>
                )}
              </div>
              
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
                        setSelectedMain(null);
                        setSelectedSub(null);
                        setSelectedItem('');
                      } catch (err: any) {
                        toast.error(err.response?.data?.error || 'Submission failed');
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
