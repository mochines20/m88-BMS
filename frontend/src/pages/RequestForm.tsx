import { useState, useMemo } from 'react';
import api from '../api';
import toast from 'react-hot-toast';

const RequestForm = () => {
  const [items, setItems] = useState([{ name: '', amount: '' }]);
  const [form, setForm] = useState({
    category: '',
    purpose: '',
    priority: 'normal'
  });
  const [loading, setLoading] = useState(false);

  const totalAmount = useMemo(() => {
    return items.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
  }, [items]);

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

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    if (items.some(item => !item.name || !item.amount)) {
      toast.error('Please fill in all item details');
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
      await api.post(
        '/api/requests',
        payload,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      toast.success('Bulk request submitted successfully!');
      setItems([{ name: '', amount: '' }]);
      setForm({ category: '', purpose: '', priority: 'normal' });
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Submission failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="text-white">
      <div className="page-header">
        <h1 className="page-title">New Request</h1>
        <p className="page-subtitle">Submit your budget request. You can now add multiple items in a single ticket.</p>
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
              <h3 className="font-semibold text-white">Multi-Item Request Form</h3>
              <p className="text-sm text-[var(--role-text)]/70">Add all items you need for this specific purpose.</p>
            </div>
          </div>
          
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
                      className="mt-3 text-red-400 hover:text-red-300 transition"
                    >
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div>
                <label className="field-label">Category</label>
                <input className="field-input" placeholder="e.g. IT Equipment" value={form.category} onChange={e => setForm({...form, category: e.target.value})} required />
              </div>
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

            <div className="rounded-2xl border border-[var(--role-secondary)]/20 bg-black/20 p-5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-[var(--role-text)]/70 uppercase tracking-widest">Total Request Amount</span>
                <span className="text-2xl font-bold text-white">
                  ₱{totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            <button className="btn-primary w-full py-4 text-lg" type="submit" disabled={loading}>
              {loading ? 'Submitting Request...' : `Submit Request for ₱${totalAmount.toLocaleString()}`}
            </button>
          </form>
        </div>

        <div className="space-y-6">
          <div className="panel">
            <h3 className="text-xl font-bold text-white">Bulk Request Tips</h3>
            <ul className="mt-4 space-y-4 text-sm text-[var(--role-text)]/80">
              <li className="flex gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--role-secondary)]/20 text-[10px] text-white">1</span>
                Grouping related items (like Laptop + Mouse) makes approval faster.
              </li>
              <li className="flex gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--role-secondary)]/20 text-[10px] text-white">2</span>
                You can add as many items as needed in one go.
              </li>
              <li className="flex gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--role-secondary)]/20 text-[10px] text-white">3</span>
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
