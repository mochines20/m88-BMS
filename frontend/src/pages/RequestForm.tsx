import { useState } from 'react';
import api from '../api';
import toast from 'react-hot-toast';

const RequestForm = () => {
  const [form, setForm] = useState({
    item_name: '',
    category: '',
    amount: '',
    purpose: '',
    priority: 'normal'
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    setLoading(true);
    const token = localStorage.getItem('token');
    try {
      await api.post('/api/requests', form, { headers: { Authorization: `Bearer ${token}` } });
      toast.success('Request submitted successfully!');
      setForm({ item_name: '', category: '', amount: '', purpose: '', priority: 'normal' });
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Submission failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="text-white">
      <div className="page-header">
        <h1 className="page-title">New Expense Request</h1>
        <p className="page-subtitle">Submit procurement and spending needs in a cleaner, easier-to-review format.</p>
      </div>

      <div className="panel max-w-3xl">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="field-label">Item Name</label>
            <input className="field-input" placeholder="e.g. Laptop" value={form.item_name} onChange={e => setForm({...form, item_name: e.target.value})} required />
          </div>
          <div>
            <label className="field-label">Category</label>
            <input className="field-input" placeholder="e.g. Equipment" value={form.category} onChange={e => setForm({...form, category: e.target.value})} required />
          </div>
          <div>
            <label className="field-label">Amount (PHP)</label>
            <input className="field-input" type="number" step="0.01" placeholder="0.00" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} required />
          </div>
          <div>
            <label className="field-label">Purpose/Justification</label>
            <textarea className="field-input min-h-[140px]" rows={4} placeholder="Describe the purpose..." value={form.purpose} onChange={e => setForm({...form, purpose: e.target.value})} />
          </div>
          <div>
            <label className="field-label">Priority</label>
            <select className="field-input" value={form.priority} onChange={e => setForm({...form, priority: e.target.value})}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <button className="btn-primary w-full" type="submit" disabled={loading}>
            {loading ? 'Submitting...' : 'Submit Request'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default RequestForm;
