import { useState, useMemo, useRef } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';

interface ReimbursementItem {
  payee_name: string;
  expense_date: string;
  expense_type: string;
  amount: string;
}

interface ReimbursementFormData {
  cash_advance_ref: string;
  cash_advance_balance: string;
  business_justification: string;
  supporting_docs: FileList | null;
}

const ReimbursementForm = () => {
  const [items, setItems] = useState<ReimbursementItem[]>([
    { payee_name: '', expense_date: '', expense_type: '', amount: '' }
  ]);
  const [form, setForm] = useState<ReimbursementFormData>({
    cash_advance_ref: '',
    cash_advance_balance: '',
    business_justification: '',
    supporting_docs: null
  });
  const [loading, setLoading] = useState(false);
  const [linkedCA, setLinkedCA] = useState<any>(null);
  const [checkingCA, setCheckingCA] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const totalAmount = useMemo(() => {
    return items.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
  }, [items]);

  const caBalance = useMemo(() => parseFloat(form.cash_advance_balance) || 0, [form.cash_advance_balance]);

  const netReimbursement = useMemo(() => {
    if (caBalance > 0) {
      return totalAmount - caBalance;
    }
    return totalAmount;
  }, [totalAmount, caBalance]);

  const addItem = () => {
    setItems([...items, { payee_name: '', expense_date: '', expense_type: '', amount: '' }]);
  };

  const removeItem = (index: number) => {
    if (items.length === 1) return;
    setItems(items.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: keyof ReimbursementItem, value: string) => {
    const next = [...items];
    next[index] = { ...next[index], [field]: value };
    setItems(next);
  };

  const checkCashAdvance = async () => {
    if (!form.cash_advance_ref) {
      toast.error('Please enter a Cash Advance reference number');
      return;
    }

    setCheckingCA(true);
    try {
      const token = localStorage.getItem('token');
      const res = await api.get(`/api/requests/${form.cash_advance_ref}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.data) {
        setLinkedCA(res.data);
        setForm(prev => ({
          ...prev,
          cash_advance_balance: String(res.data.amount - (res.data.amount_reimbursed || 0))
        }));
        toast.success('Cash Advance found');
      }
    } catch {
      toast.error('Cash Advance not found');
      setLinkedCA(null);
    } finally {
      setCheckingCA(false);
    }
  };

  const handleSubmit = async (e: any) => {
    e.preventDefault();

    if (items.some(item => !item.payee_name || !item.expense_date || !item.amount) || !form.business_justification) {
      toast.error('Please fill in all required fields for all items');
      return;
    }

    if (totalAmount <= 0) {
      toast.error('Total amount must be greater than zero');
      return;
    }

    setLoading(true);
    const token = localStorage.getItem('token');

    // Handle file uploads if any
    let attachments: any[] = [];
    if (form.supporting_docs && form.supporting_docs.length > 0) {
      if (!supabase) {
        toast.error('Supabase client not initialized. Cannot upload files.');
        setLoading(false);
        return;
      }

      for (let i = 0; i < form.supporting_docs.length; i++) {
        const file = form.supporting_docs[i];
        const fileExt = file.name.split('.').pop();
        const fileName = `${Math.random().toString(36).substring(2, 15)}_${Date.now()}.${fileExt}`;
        const filePath = `attachments/${fileName}`;

        try {
          const { error: uploadError } = await supabase.storage
            .from('attachments')
            .upload(filePath, file);

          if (uploadError) throw uploadError;

          const { data: { publicUrl } } = supabase.storage
            .from('attachments')
            .getPublicUrl(filePath);

          attachments.push({
            file_name: file.name,
            file_url: publicUrl,
            attachment_type: file.type,
            attachment_scope: 'request'
          });
        } catch (uploadErr: any) {
          toast.error(`Failed to upload ${file.name}: ${uploadErr.message}`);
          setLoading(false);
          return;
        }
      }
    }

    const combinedItemName = items.map(item => `${item.payee_name} (${item.expense_type})`).join(', ');
    const itemBreakdown = items.map(item => 
      `${item.expense_date} | ${item.payee_name} | ${item.expense_type}: ₱${parseFloat(item.amount).toLocaleString(undefined, { minimumFractionDigits: 2 }) }`
    ).join('\n');

    const payload = {
      item_name: `[REIMBURSEMENT] ${combinedItemName}`,
      category: 'Reimbursement',
      amount: totalAmount,
      purpose: `Business Justification:\n${form.business_justification}\n\nItem Breakdown:\n${itemBreakdown}\n\n${linkedCA ? `Cash Advance Reference: ${form.cash_advance_ref}\nCash Advance Balance: ₱${caBalance.toFixed(2)}\n` : ''}Net Reimbursement: ₱${netReimbursement.toFixed(2)}`,
      priority: 'normal',
      request_type: 'reimbursement',
      project_id: null,
      vendor_id: null,
      business_reason: form.business_justification,
      attachments,
      metadata: {
        items: items.map(item => ({
          ...item,
          amount: parseFloat(item.amount)
        })),
        cash_advance_ref: form.cash_advance_ref || null,
        cash_advance_balance: linkedCA ? caBalance : null,
        total_amount: totalAmount,
        net_reimbursement: netReimbursement
      }
    };

    try {
      await api.post('/api/requests', payload, {
        headers: { Authorization: `Bearer ${token}` }
      });

      toast.success('Multi-item reimbursement claim submitted successfully!');
      setItems([{ payee_name: '', expense_date: '', expense_type: '', amount: '' }]);
      setForm({
        cash_advance_ref: '',
        cash_advance_balance: '',
        business_justification: '',
        supporting_docs: null
      });
      setLinkedCA(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
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
        <h1 className="page-title">Reimbursement Claim</h1>
        <p className="page-subtitle">Submit a reimbursement for out-of-pocket expenses. You can now add multiple items in a single claim.</p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px]">
        <div className="panel">
          <div className="mb-6 flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--role-secondary)]/20 bg-[var(--role-secondary)]/10">
              <svg className="h-5 w-5 text-[var(--role-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
              </svg>
            </div>
            <div>
              <h3 className="font-bold text-[var(--role-text)]">Multi-Item Reimbursement Form</h3>
              <p className="text-sm text-[var(--role-text)]/70">Add all receipts you need to claim for this purpose.</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="field-label !mb-0">Expense Items</label>
                <button 
                  type="button" 
                  onClick={addItem}
                  className="text-xs font-bold uppercase tracking-wider text-[var(--role-secondary)] hover:brightness-110"
                >
                  + Add Another Item
                </button>
              </div>

              {items.map((item, index) => (
                <div key={index} className="space-y-3 rounded-2xl border border-[var(--role-border)]/10 bg-[var(--role-accent)] p-4 animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-widest text-[var(--role-text)]/40">Item #{index + 1}</span>
                    {items.length > 1 && (
                      <button 
                        type="button" 
                        onClick={() => removeItem(index)}
                        className="text-red-500 hover:text-red-600 transition"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="field-label !text-[10px] uppercase">Payee Name</label>
                      <input
                        className="field-input !py-2 !text-sm"
                        placeholder="e.g. Starbucks, Shell"
                        value={item.payee_name}
                        onChange={e => updateItem(index, 'payee_name', e.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <label className="field-label !text-[10px] uppercase">Date</label>
                      <input
                        className="field-input !py-2 !text-sm"
                        type="date"
                        value={item.expense_date}
                        onChange={e => updateItem(index, 'expense_date', e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="field-label !text-[10px] uppercase">Expense Type</label>
                      <select
                        className="field-input !py-2 !text-sm"
                        value={item.expense_type}
                        onChange={e => updateItem(index, 'expense_type', e.target.value)}
                        required
                      >
                        <option value="">Select type...</option>
                        <option value="Travel">Travel / Transportation</option>
                        <option value="Meals">Meals / Entertainment</option>
                        <option value="Supplies">Office Supplies</option>
                        <option value="Equipment">Equipment / Hardware</option>
                        <option value="Software">Software / Subscriptions</option>
                        <option value="Communication">Communication / Internet</option>
                        <option value="Utilities">Utilities</option>
                        <option value="Professional">Professional Services</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="field-label !text-[10px] uppercase">Amount</label>
                      <input
                        className="field-input !py-2 !text-sm"
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={item.amount}
                        onChange={e => updateItem(index, 'amount', e.target.value)}
                        required
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-[var(--role-secondary)]/20 bg-[var(--role-secondary)]/5 p-5">
              <h4 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--role-text)]/70">Link to Cash Advance (Optional)</h4>
              <div className="flex gap-3">
                <input
                  className="field-input flex-1"
                  placeholder="Cash Advance Request Code (e.g., CA-2024-001)"
                  value={form.cash_advance_ref}
                  onChange={e => {
                    setForm({ ...form, cash_advance_ref: e.target.value });
                    setLinkedCA(null);
                  }}
                />
                <button
                  type="button"
                  onClick={checkCashAdvance}
                  disabled={checkingCA || !form.cash_advance_ref}
                  className="btn-secondary whitespace-nowrap"
                >
                  {checkingCA ? 'Checking...' : 'Check CA'}
                </button>
              </div>
              {linkedCA && (
                <div className="mt-3 rounded-xl bg-white/40 p-4 border border-[var(--role-border)]/10">
                  <p className="text-[var(--role-text)]/70 font-medium">Cash Advance: <span className="text-[var(--role-text)] font-bold">{linkedCA.request_code}</span></p>
                  <p className="text-[var(--role-text)]/70 font-medium">Original Amount: <span className="text-[var(--role-text)] font-bold">₱{Number(linkedCA.amount).toFixed(2)}</span></p>
                  <p className="text-[var(--role-text)]/70 font-medium">Outstanding Balance: <span className="text-orange-600 font-bold">₱{caBalance.toFixed(2)}</span></p>
                </div>
              )}
            </div>

            <div>
              <label className="field-label">Business Justification *</label>
              <textarea
                className="field-input min-h-[100px]"
                rows={4}
                placeholder="Explain why this expense was necessary and how it benefits the company..."
                value={form.business_justification}
                onChange={e => setForm({ ...form, business_justification: e.target.value })}
                required
              />
            </div>

            <div>
              <label className="field-label">Supporting Documents</label>
              <div className="field-input cursor-pointer border-2 border-dashed border-[var(--role-secondary)]/30 bg-[var(--role-accent)] hover:border-[var(--role-secondary)]/50">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                  onChange={e => setForm({ ...form, supporting_docs: e.target.files })}
                  className="w-full text-sm text-[var(--role-text)]/70 file:mr-4 file:cursor-pointer file:rounded file:border-0 file:bg-[var(--role-secondary)]/20 file:px-3 file:py-1 file:text-xs file:font-bold file:text-[var(--role-primary)] file:transition hover:file:bg-[var(--role-secondary)]/30"
                />
              </div>
              <p className="mt-1 text-xs text-[var(--role-text)]/50 font-medium">Upload receipts, invoices, or other supporting documents (PDF, JPG, PNG, DOC)</p>
            </div>

            <div className="rounded-2xl border border-[var(--role-secondary)]/20 bg-[var(--role-accent)] p-5">
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between opacity-70">
                  <span className="text-sm font-bold uppercase tracking-widest text-[var(--role-text)]">Gross Claim Amount</span>
                  <span className="text-xl font-bold text-[var(--role-text)]">₱{totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                {caBalance > 0 && (
                  <div className="flex items-center justify-between text-red-600">
                    <span className="text-sm font-bold uppercase tracking-widest">Less: Cash Advance</span>
                    <span className="text-xl font-bold">- ₱{caBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                <div className="border-t border-[var(--role-border)]/20 pt-4 flex items-center justify-between">
                  <span className="text-sm font-bold uppercase tracking-widest text-[var(--role-secondary)]">Net Reimbursement</span>
                  <span className="text-3xl font-bold text-[var(--role-text)]">
                    ₱{netReimbursement.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>

            <button className="btn-primary w-full py-4 text-lg" type="submit" disabled={loading}>
              {loading ? 'Submitting Claim...' : `Submit Claim for ₱${netReimbursement.toLocaleString()}`}
            </button>
          </form>
        </div>

        <div className="space-y-6">
          <div className="panel">
            <h3 className="text-xl font-bold text-[var(--role-text)]">Reimbursement Tips</h3>
            <ul className="mt-4 space-y-4 text-sm text-[var(--role-text)]/80">
              <li className="flex gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--role-secondary)]/20 text-[10px] text-[var(--role-primary)] font-bold">1</span>
                You can now bundle multiple receipts into a single claim.
              </li>
              <li className="flex gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--role-secondary)]/20 text-[10px] text-[var(--role-primary)] font-bold">2</span>
                If you have a Cash Advance, the system will calculate the net amount.
              </li>
              <li className="flex gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--role-secondary)]/20 text-[10px] text-[var(--role-primary)] font-bold">3</span>
                Make sure all receipt dates and merchant names are accurate.
              </li>
            </ul>
          </div>

          <div className="panel-muted border-dashed">
            <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--role-text)]/60">Documentation</h3>
            <p className="mt-3 text-sm leading-relaxed text-[var(--role-text)]/70 font-medium">
              Physical receipts must still be submitted to accounting after digital submission for auditing purposes.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReimbursementForm;
