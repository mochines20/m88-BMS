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
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
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

      const fetchNotifications = async () => {
        try {
          const res = await api.get('/api/notifications', { headers: { Authorization: `Bearer ${token}` } });
          setNotifications(res.data || []);
        } catch {
          // Silently fail
        }
      };

      refreshPendingApprovals();
      fetchNotifications();
      const intervalId = window.setInterval(() => {
        refreshPendingApprovals();
        fetchNotifications();
      }, 10000);
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

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'employee':
        return (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        );
      case 'supervisor':
        return (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        );
      case 'accounting':
        return (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      default:
        return (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        );
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'employee': return 'Employee Workspace';
      case 'supervisor': return 'Supervisor Portal';
      case 'accounting': return 'Finance Control';
      case 'admin': return 'System Admin';
      case 'super_admin': return 'Root Access';
      default: return 'BMS Access';
    }
  };

  if (!user) {
    return (
      <div className="app-shell flex min-h-screen items-center justify-center px-6">
        <div className="panel w-full max-w-md overflow-hidden text-center">
          <div className="mx-auto mb-5 flex items-center justify-center">
            <div className="bms-spinner" />
          </div>
          <p className="text-xl font-semibold text-white">Loading BMS Workspace</p>
          <p className="mt-2 text-sm text-[var(--role-text)]/70">Securing access, syncing roles, and preparing your dashboard.</p>
          <div className="mt-6 space-y-3">
            <div className="bms-shimmer h-3 w-full rounded-full" />
            <div className="bms-shimmer h-3 w-10/12 rounded-full" />
            <div className="bms-shimmer h-3 w-8/12 rounded-full" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell" data-role={user.role}>
      <Toaster position="top-right" />
      <nav className="nav-surface">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex items-center gap-4">
            <img
              src="/madison88-logo.png"
              alt="Madison88"
              className="h-12 w-auto rounded-xl border border-white/15 bg-[#f8fbff] px-3 py-2 shadow-[0_10px_30px_rgba(0,0,0,0.24)]"
            />
            <div className="flex flex-col">
              <p className="text-sm font-bold text-white flex items-center gap-2">
                <span className="opacity-70">{getRoleIcon(user.role)}</span>
                {getRoleLabel(user.role)}
              </p>
              <p className="text-xs text-slate-400">Welcome, {normalizeDisplayName(user.name)}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className="relative rounded-full border border-[var(--role-border)] bg-black/20 p-2.5 transition hover:bg-black/30"
              >
                <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                {notifications.filter(n => !n.is_read).length > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                    {notifications.filter(n => !n.is_read).length}
                  </span>
                )}
              </button>
              {showNotifications && (
                <div className="absolute right-4 top-20 z-50 w-80 max-h-96 overflow-y-auto rounded-2xl border border-[var(--role-border)] bg-[var(--bms-bg-2)] shadow-2xl">
                  <div className="sticky top-0 flex items-center justify-between border-b border-white/10 bg-[var(--bms-bg-2)] p-4">
                    <h3 className="font-bold text-white">Notifications</h3>
                    <button onClick={() => setShowNotifications(false)} className="text-white/60 hover:text-white">
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <div className="divide-y divide-white/5">
                    {notifications.length === 0 ? (
                      <p className="p-4 text-center text-white/60">No notifications yet</p>
                    ) : (
                      notifications.slice(0, 10).map((notification: any) => (
                        <div
                          key={notification.id}
                          className={`p-4 transition hover:bg-white/5 ${!notification.is_read ? 'bg-white/5' : ''}`}
                        >
                          <p className="text-sm text-white">{notification.message}</p>
                          <p className="mt-1 text-xs text-white/50">{notification.created_at ? new Date(notification.created_at).toLocaleString() : 'Just now'}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
              <Link to="/" className={getNavClassName('/')}>Overview</Link>
              {user.role === 'employee' && (
                <>
                  <Link to="/request" className={getNavClassName('/request')}>New Request</Link>
                  <Link to="/reimbursement" className={getNavClassName('/reimbursement')}>Reimbursement</Link>
                  <Link to="/tracker" className={getNavClassName('/tracker')}>My History</Link>
                </>
              )}
              {(user.role === 'supervisor' || user.role === 'accounting') && (
                <Link to="/approvals" className={`${getNavClassName('/approvals')} relative`}>
                  {user.role === 'supervisor' ? 'Team Approvals' : 'Fund Releases'}
                  {pendingApprovalsCount > 0 && (
                    <span className="ml-2 inline-flex min-w-[22px] items-center justify-center rounded-full border border-white/20 bg-white/10 px-1.5 py-0.5 text-xs font-semibold text-white">
                      {pendingApprovalsCount}
                    </span>
                  )}
                </Link>
              )}
              {user.role !== 'employee' && user.role !== 'super_admin' && (
                <Link to="/reports" className={getNavClassName('/reports')}>Analytics</Link>
              )}
              {(user.role === 'admin' || user.role === 'accounting' || user.role === 'super_admin') && (
                <Link to="/admin" className={getNavClassName('/admin')}>
                  {user.role === 'accounting' ? 'Budget Matrix' : user.role === 'super_admin' ? 'Root' : 'Admin'}
                </Link>
              )}
              {(user.role === 'employee' || user.role === 'supervisor') && (
                <Link to="/profile" className={getNavClassName('/profile')}>Settings</Link>
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
