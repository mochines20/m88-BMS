import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import toast from 'react-hot-toast';
import { formatMoney, toNumber, getStatusColor } from '../utils/format';

interface Request {
  id: string;
  request_code: string;
  request_type: string;
  item_name: string;
  status: string;
  amount: number;
  submitted_at: string;
}

interface CashAdvance {
  id: string;
  advance_code: string;
  amount_issued: number;
  balance: number;
  status: string;
  issued_at: string;
  liquidation_due_at: string;
}

const getEmployeeStatusLabel = (status: string, requestType?: string) => {
  // Employee view uses simplified labels
  switch (status) {
    case 'pending_supervisor':
    case 'pending_accounting':
      return 'Pending';
    case 'on_hold':
      return 'On Hold';
    case 'approved':
      return 'Approved';
    case 'released':
      return requestType === 'cash_advance' ? 'Issued' : 'Released';
    case 'rejected':
      return 'Rejected';
    case 'returned_for_revision':
      return 'Returned';
    default:
      return status.replace(/_/g, ' ');
  }
};

const getRequestTypeLabel = (type: string) => {
  switch (type) {
    case 'reimbursement':
      return 'Reimbursement';
    case 'cash_advance':
      return 'Cash Advance';
    case 'liquidation':
      return 'Liquidation';
    default:
      return 'Expense';
  }
};

const EmployeeHome = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [myRequests, setMyRequests] = useState<Request[]>([]);
  const [myCashAdvances, setMyCashAdvances] = useState<CashAdvance[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/login');
      return;
    }

    const loadData = async () => {
      try {
        const [userRes, requestsRes] = await Promise.all([
          api.get('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } }),
          api.get('/api/requests/my', { headers: { Authorization: `Bearer ${token}` } }),
        ]);

        setUser(userRes.data);
        setMyRequests(requestsRes.data || []);

        const advancesRes = await api.get(`/api/cash-advances/employee/${userRes.data.id}`, {
          headers: { Authorization: `Bearer ${token}` }
        }).catch(() => ({ data: [] }));
        setMyCashAdvances((advancesRes as any).data || []);
      } catch (err) {
        toast.error('Failed to load data');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [navigate]);

  const outstandingCashAdvances = myCashAdvances.filter(
    ca => ca.status === 'outstanding' || ca.status === 'partially_liquidated' || ca.status === 'overdue'
  );

  const recentRequests = myRequests.slice(0, 5);

  const handleLiquidateClick = (advanceId: string) => {
    navigate(`/requests/new?type=liquidation&advance_id=${advanceId}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="bms-spinner"></div>
      </div>
    );
  }

  return (
    <div className="text-[var(--role-text)] page-transition">
      {/* Welcome Header */}
      <div className="page-header">
        <h1 className="page-title">Welcome, {user?.name || user?.email?.split('@')[0] || 'Employee'}</h1>
        <p className="page-subtitle">Submit and track your expense requests</p>
      </div>


      {/* Outstanding Cash Advances Section */}
      {outstandingCashAdvances.length > 0 && (
        <div className="panel mb-8">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Outstanding Cash Advances
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {outstandingCashAdvances.map((advance) => (
              <div key={advance.id} className="border border-[var(--role-border)] rounded-2xl p-4 bg-[var(--role-accent)]/50">
                <div className="flex justify-between items-start mb-2">
                  <p className="font-medium">{advance.advance_code}</p>
                  <span className={`px-2 py-1 rounded-full text-xs ${getStatusColor(advance.status)}`}>
                    {advance.status.replace(/_/g, ' ')}
                  </span>
                </div>
                <p className="text-2xl font-bold text-[var(--role-text)] mb-1">
                  {formatMoney(toNumber(advance.balance))}
                </p>
                <p className="text-sm text-[var(--role-text)]/60 mb-3">
                  Balance remaining
                </p>
                <div className="flex items-center gap-2 text-sm text-[var(--role-text)]/60 mb-3">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Due: {advance.liquidation_due_at ? new Date(advance.liquidation_due_at).toLocaleDateString() : 'N/A'}
                </div>
                <button
                  onClick={() => handleLiquidateClick(advance.id)}
                  className="w-full btn-primary text-sm py-2"
                >
                  Liquidate Now
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* My Requests Table */}
      <div className="panel">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <svg className="w-5 h-5 text-[var(--role-primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            My Requests
          </h2>
          <button 
            onClick={() => navigate('/tracker')}
            className="text-sm text-[var(--role-primary)] hover:underline"
          >
            View All →
          </button>
        </div>

        {recentRequests.length === 0 ? (
          <div className="text-center py-8 text-[var(--role-text)]/60">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p>No requests yet</p>
            <p className="text-sm mt-1">Submit your first reimbursement or cash advance</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-[var(--role-border)]">
                <tr className="text-left text-xs uppercase tracking-[0.14em] text-[var(--role-text)]/60">
                  <th className="pb-3 font-medium">Type</th>
                  <th className="pb-3 font-medium">Ref No</th>
                  <th className="pb-3 font-medium">Description</th>
                  <th className="pb-3 font-medium">Date</th>
                  <th className="pb-3 font-medium">Status</th>
                  <th className="pb-3 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--role-border)]">
                {recentRequests.map((req) => (
                  <tr 
                    key={req.id} 
                    className="hover:bg-[var(--role-accent)]/30 transition-colors cursor-pointer"
                    onClick={() => navigate('/tracker')}
                  >
                    <td className="py-3">
                      <span className="text-sm">{getRequestTypeLabel(req.request_type || 'reimbursement')}</span>
                    </td>
                    <td className="py-3">
                      <span className="font-medium text-sm">{req.request_code}</span>
                    </td>
                    <td className="py-3">
                      <span className="text-sm text-[var(--role-text)]/80">{req.item_name}</span>
                    </td>
                    <td className="py-3">
                      <span className="text-xs text-[var(--role-text)]/60">{new Date(req.submitted_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    </td>
                    <td className="py-3">
                      <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(req.status)}`}>
                        {getEmployeeStatusLabel(req.status, req.request_type)}
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      <span className="font-medium text-sm">{formatMoney(toNumber(req.amount))}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default EmployeeHome;
