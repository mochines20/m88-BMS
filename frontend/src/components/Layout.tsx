import { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import api from '../api';
import { Toaster } from 'react-hot-toast';

interface LayoutProps {
  children: ReactNode;
}

const normalizeDisplayName = (name: string) => {
  const trimmedName = String(name || '').trim();
  return trimmedName.toLowerCase() === 'byahero' ? 'Byahero' : trimmedName;
};

const Layout = ({ children }: LayoutProps) => {
  const [user, setUser] = useState<any>(null);
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      api.get('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
        .then(res => setUser(res.data))
        .catch(() => {
          localStorage.removeItem('token');
          navigate('/login');
        });

      const refreshPendingApprovals = async () => {
        try {
          const meResponse = await api.get('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
          const currentUser = meResponse.data;
          setUser(currentUser);

          if (currentUser.role === 'supervisor' || currentUser.role === 'accounting') {
            const requestsResponse = await api.get('/api/requests', { headers: { Authorization: `Bearer ${token}` } });
            const pendingCount = requestsResponse.data.filter((request: any) =>
              (currentUser.role === 'supervisor' && request.status === 'pending_supervisor') ||
              (currentUser.role === 'accounting' && request.status === 'pending_accounting')
            ).length;
            setPendingApprovalsCount(pendingCount);
          } else {
            setPendingApprovalsCount(0);
          }
        } catch {
          setPendingApprovalsCount(0);
        }
      };

      refreshPendingApprovals();
      const intervalId = window.setInterval(refreshPendingApprovals, 7000);
      return () => window.clearInterval(intervalId);
    } else {
      navigate('/login');
    }
  }, [navigate]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    navigate('/login');
  };

  const getNavClassName = (path: string) => location.pathname === path ? 'nav-link-accent' : 'nav-link';

  if (!user) {
    return (
      <div className="app-shell flex min-h-screen items-center justify-center px-6">
        <div className="panel w-full max-w-md text-center">
          <div className="mx-auto mb-4 h-16 w-16 rounded-full border border-white/10 bg-white/5" />
          <p className="text-xl font-semibold text-white">Loading your workspace...</p>
          <p className="mt-2 text-sm text-slate-300">Preparing the Madison88 Budget Management System.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Toaster position="top-right" />
      <nav className="nav-surface">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex items-center gap-4">
            <img
              src="/madison88-logo.png"
              alt="Madison88"
              className="h-12 w-auto rounded-xl border border-[#D9E1F1]/40 bg-[#f8fbff] px-3 py-2 shadow-[0_8px_24px_rgba(5,10,20,0.18)]"
            />
            <p className="text-sm text-slate-300">Welcome, {normalizeDisplayName(user.name)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-2">
              <Link to="/" className={getNavClassName('/')}>Dashboard</Link>
              {user.role === 'employee' && (
                <>
                  <Link to="/request" className={getNavClassName('/request')}>New Request</Link>
                  <Link to="/tracker" className={getNavClassName('/tracker')}>My Requests</Link>
                </>
              )}
              {(user.role === 'supervisor' || user.role === 'accounting') && (
                <Link to="/approvals" className={`${getNavClassName('/approvals')} relative`}>
                  Approvals
                  {pendingApprovalsCount > 0 && (
                    <span className="ml-2 inline-flex min-w-[22px] items-center justify-center rounded-full border border-[#8FB3E2]/30 bg-[#8FB3E2]/18 px-1.5 py-0.5 text-xs font-semibold text-white">
                      {pendingApprovalsCount}
                    </span>
                  )}
                </Link>
              )}
              {user.role !== 'employee' && user.role !== 'super_admin' && (
                <Link to="/reports" className={getNavClassName('/reports')}>Reports</Link>
              )}
              {(user.role === 'admin' || user.role === 'accounting' || user.role === 'super_admin') && (
                <Link to="/admin" className={getNavClassName('/admin')}>
                  {user.role === 'accounting' ? 'Budget Management' : user.role === 'super_admin' ? 'Super Admin' : 'Admin'}
                </Link>
              )}
              {(user.role === 'employee' || user.role === 'supervisor') && (
                <Link to="/profile" className={getNavClassName('/profile')}>My Profile</Link>
              )}
            </div>
            <button onClick={handleLogout} className="btn-danger !rounded-full !px-4 !py-2 !text-sm">Logout</button>
          </div>
        </div>
      </nav>
      <main className="mx-auto max-w-[92rem] px-4 py-8 lg:px-8 lg:py-10">
        <div key={location.pathname} className="page-stage">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;
