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
  const [attachments, setAttachments] = useState([{ file_name: '', file_url: '', attachment_type: 'supporting_document' }]);
  const [loading, setLoading] = useState(false);

  const updateAttachment = (index: number, field: 'file_name' | 'file_url' | 'attachment_type', value: string) => {
    setAttachments((current) => current.map((attachment, attachmentIndex) => (attachmentIndex === index ? { ...attachment, [field]: value } : attachment)));
  };

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    setLoading(true);
    const token = localStorage.getItem('token');
    try {
      await api.post(
        '/api/requests',
        {
          ...form,
          attachments: attachments.filter((attachment) => attachment.file_name.trim() && attachment.file_url.trim())
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      toast.success('Request submitted successfully!');
      setForm({ item_name: '', category: '', amount: '', purpose: '', priority: 'normal' });
      setAttachments([{ file_name: '', file_url: '', attachment_type: 'supporting_document' }]);
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
          <div className="space-y-3 rounded-[24px] border border-[#8FB3E2]/12 bg-black/10 p-4">
            <div>
              <label className="field-label">Supporting Documents</label>
              <p className="text-sm text-[#D9E1F1]/70">Add links to quotations, receipts, canvass sheets, or related files.</p>
            </div>
            {attachments.map((attachment, index) => (
              <div key={index} className="grid grid-cols-1 gap-3 md:grid-cols-[180px_minmax(0,1fr)_minmax(0,1.2fr)]">
                <select className="field-input" value={attachment.attachment_type} onChange={e => updateAttachment(index, 'attachment_type', e.target.value)}>
                  <option value="supporting_document">Supporting Doc</option>
                  <option value="quotation">Quotation</option>
                  <option value="receipt">Receipt</option>
                  <option value="invoice">Invoice</option>
                </select>
                <input className="field-input" placeholder="File label" value={attachment.file_name} onChange={e => updateAttachment(index, 'file_name', e.target.value)} />
                <input className="field-input" placeholder="https://file-link" value={attachment.file_url} onChange={e => updateAttachment(index, 'file_url', e.target.value)} />
              </div>
            ))}
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setAttachments((current) => [...current, { file_name: '', file_url: '', attachment_type: 'supporting_document' }])}
            >
              Add Document Link
            </button>
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
