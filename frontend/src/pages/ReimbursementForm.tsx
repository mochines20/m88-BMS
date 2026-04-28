import { useState, useMemo } from 'react';
import api from '../api';
import toast from 'react-hot-toast';

interface ReimbursementFormData {
  payee_name: string;
  expense_date: string;
  expense_type: string;
  amount: string;
  cash_advance_ref: string;
  cash_advance_balance: string;
  amount_claimed: string;
  business_justification: string;
  supporting_docs: FileList | null;
}

const ReimbursementForm = () => {
  const [form, setForm] = useState<ReimbursementFormData>({
    payee_name: '',
    expense_date: '',
    expense_type: '',
    amount: '',
    cash_advance_ref: '',
    cash_advance_balance: '',
    amount_claimed: '',
    business_justification: '',
    supporting_docs: null
  });
  const [loading, setLoading] = useState(false);
  const [linkedCA, setLinkedCA] = useState<any>(null);
  const [checkingCA, setCheckingCA] = useState(false);

  const claimedAmount = useMemo(() => parseFloat(form.amount_claimed) || 0, [form.amount_claimed]);
  const expenseAmount = useMemo(() => parseFloat(form.amount) || 0, [form.amount]);
  const caBalance = useMemo(() => parseFloat(form.cash_advance_balance) || 0, [form.cash_advance_balance]);

  const netReimbursement = useMemo(() => {
    if (caBalance > 0) {
      return claimedAmount - caBalance;
    }
    return claimedAmount;
  }, [claimedAmount, caBalance]);

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

    if (!form.payee_name || !form.expense_date || !form.amount || !form.business_justification) {
      toast.error('Please fill in all required fields');
      return;
    }

    if (claimedAmount <= 0) {
      toast.error('Claimed amount must be greater than zero');
      return;
    }

    setLoading(true);
    const token = localStorage.getItem('token');

    const payload = {
      item_name: `[REIMBURSEMENT] ${form.expense_type || 'Expense'}: ${form.payee_name}`,
      category: 'Reimbursement',
      amount: claimedAmount,
      purpose: `Payee: ${form.payee_name}\nExpense Date: ${form.expense_date}\nExpense Type: ${form.expense_type}\n\nBusiness Justification:\n${form.business_justification}\n\n${linkedCA ? `Cash Advance Reference: ${form.cash_advance_ref}\nCash Advance Balance: ₱${caBalance.toFixed(2)}\n` : ''}Net Reimbursement: ₱${netReimbursement.toFixed(2)}`,
      priority: 'normal',
      request_type: 'reimbursement',
      project_id: null,
      vendor_id: null,
      business_reason: form.business_justification,
      metadata: {
        payee_name: form.payee_name,
        expense_date: form.expense_date,
        expense_type: form.expense_type,
        original_amount: expenseAmount,
        cash_advance_ref: form.cash_advance_ref || null,
        cash_advance_balance: linkedCA ? caBalance : null,
        amount_claimed: claimedAmount,
        net_reimbursement: netReimbursement
      }
    };

    try {
      await api.post('/api/requests', payload, {
        headers: { Authorization: `Bearer ${token}` }
      });

      toast.success('Reimbursement claim submitted successfully!');
      setForm({
        payee_name: '',
        expense_date: '',
        expense_type: '',
        amount: '',
        cash_advance_ref: '',
        cash_advance_balance: '',
        amount_claimed: '',
        business_justification: '',
        supporting_docs: null
      });
      setLinkedCA(null);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Submission failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="text-white">
      <div className="page-header">
        <h1 className="page-title">Reimbursement Claim</h1>
        <p className="page-subtitle">Submit a reimbursement for out-of-pocket expenses. Attach supporting receipts and documents.</p>
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
              <h3 className="font-semibold text-white">Reimbursement Form</h3>
              <p className="text-sm text-[var(--role-text)]/70">Fill in the expense details and attach receipts.</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div>
                <label className="field-label">Payee Name *</label>
                <input
                  className="field-input"
                  placeholder="Name of the payee/merchant"
                  value={form.payee_name}
                  onChange={e => setForm({ ...form, payee_name: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="field-label">Expense Date *</label>
                <input
                  className="field-input"
                  type="date"
                  value={form.expense_date}
                  onChange={e => setForm({ ...form, expense_date: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div>
                <label className="field-label">Expense Type</label>
                <select
                  className="field-input"
                  value={form.expense_type}
                  onChange={e => setForm({ ...form, expense_type: e.target.value })}
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
                <label className="field-label">Original Amount *</label>
                <input
                  className="field-input"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={form.amount}
                  onChange={e => setForm({ ...form, amount: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--role-secondary)]/20 bg-[var(--role-secondary)]/5 p-5">
              <h4 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[var(--role-text)]/70">Link to Cash Advance (Optional)</h4>
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
                <div className="mt-3 rounded-lg bg-black/20 p-3 text-sm">
                  <p className="text-[var(--role-text)]/70">Cash Advance: <span className="text-white">{linkedCA.request_code}</span></p>
                  <p className="text-[var(--role-text)]/70">Original Amount: <span className="text-white">₱{Number(linkedCA.amount).toFixed(2)}</span></p>
                  <p className="text-[var(--role-text)]/70">Outstanding Balance: <span className="text-yellow-400">₱{caBalance.toFixed(2)}</span></p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div>
                <label className="field-label">Amount to Claim *</label>
                <input
                  className="field-input"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={form.amount_claimed}
                  onChange={e => setForm({ ...form, amount_claimed: e.target.value })}
                  required
                />
              </div>
              {linkedCA && caBalance > 0 && (
                <div>
                  <label className="field-label">Net Reimbursement</label>
                  <div className={`field-input bg-black/20 ${netReimbursement < 0 ? 'border-red-500' : ''}`}>
                    <span className={netReimbursement < 0 ? 'text-red-400' : 'text-green-400'}>
                      ₱{Math.abs(netReimbursement).toFixed(2)}
                      {netReimbursement < 0 && ' (Excess)'}
                    </span>
                  </div>
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
              <div className="field-input cursor-pointer border-2 border-dashed border-[var(--role-secondary)]/30 bg-transparent hover:border-[var(--role-secondary)]/50">
                <input
                  type="file"
                  multiple
                  accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                  onChange={e => setForm({ ...form, supporting_docs: e.target.files })}
                  className="w-full text-sm text-[var(--role-text)]/70 file:mr-4 file:cursor-pointer file:rounded file:border-0 file:bg-[var(--role-secondary)]/20 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-white file:transition hover:file:bg-[var(--role-secondary)]/30"
                />
              </div>
              <p className="mt-1 text-xs text-[var(--role-text)]/50">Upload receipts, invoices, or other supporting documents (PDF, JPG, PNG, DOC)</p>
            </div>

            <div className="rounded-2xl border border-[var(--role-secondary)]/20 bg-black/20 p-5">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--role-text)]/70">Original Expense</span>
                  <span className="text-white">₱{expenseAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                {linkedCA && caBalance > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-[var(--role-text)]/70">Less: CA Balance</span>
                    <span className="text-yellow-400">- ₱{caBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-[var(--role-secondary)]/20 pt-2">
                  <span className="text-sm font-semibold uppercase tracking-widest text-[var(--role-text)]/70">Net Claim</span>
                  <span className="text-xl font-bold text-white">
                    ₱{claimedAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>

            <button
              className="btn-primary w-full py-4 text-lg"
              type="submit"
              disabled={loading}
            >
              {loading ? 'Submitting Claim...' : `Submit Reimbursement Claim`}
            </button>
          </form>
        </div>

        <div className="space-y-6">
          <div className="panel">
            <h3 className="text-xl font-bold text-white">Reimbursement Guidelines</h3>
            <ul className="mt-4 space-y-4 text-sm text-[var(--role-text)]/80">
              <li className="flex gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--role-secondary)]/20 text-[10px] text-white">1</span>
                Submit claims within 5 business days of the expense.
              </li>
              <li className="flex gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--role-secondary)]/20 text-[10px] text-white">2</span>
                Always attach original receipts or invoices.
              </li>
              <li className="flex gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--role-secondary)]/20 text-[10px] text-white">3</span>
                If you have an outstanding Cash Advance, it will be deducted from your claim.
              </li>
              <li className="flex gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--role-secondary)]/20 text-[10px] text-white">4</span>
                Claims without proper justification may be returned.
              </li>
            </ul>
          </div>

          <div className="panel-muted border-dashed">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--role-text)]/60">Required Fields</h3>
            <p className="mt-3 text-sm leading-relaxed text-[var(--role-text)]/70">
              Fields marked with (*) are required. Supporting documents are mandatory for expenses over ₱1,000.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReimbursementForm;
