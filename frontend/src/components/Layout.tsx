import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import api from '../api';
import toast, { Toaster } from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { normalizeDisplayName } from '../utils/format';

interface LayoutProps {
  children: ReactNode;
}

const Layout = ({ children }: LayoutProps) => {
  const [user, setUser] = useState<any>(null);
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const notificationRef = useRef<HTMLDivElement>(null);
  const userIdRef = useRef<string | null>(null);

  // Close notification dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (notificationRef.current && !notificationRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
    };
    if (showNotifications) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showNotifications]);

  // Close mobile menu on route change
  useEffect(() => { setMobileMenuOpen(false); }, [location.pathname]);

  const fetchNotifications = useCallback(async (token: string) => {
    try {
      const res = await api.get('/api/notifications', { headers: { Authorization: `Bearer ${token}` } });
      setNotifications(Array.isArray(res.data) ? res.data : []);
    } catch { /* silent */ }
  }, []);

  const markAllRead = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      await api.patch('/api/notifications/mark-all-read', {}, { headers: { Authorization: `Bearer ${token}` } });
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      toast.success('All notifications marked as read');
    } catch { /* silent */ }
  };

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { navigate('/login'); return; }

    let cancelled = false;

    const bootstrap = async () => {
      try {
        const meRes = await api.get('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
        if (cancelled) return;
        const currentUser = meRes.data;
        setUser(currentUser);
        userIdRef.current = currentUser.id;

        if (currentUser.role === 'supervisor' || currentUser.role === 'accounting') {
          const reqRes = await api.get('/api/requests', { headers: { Authorization: `Bearer ${token}` } });
          if (cancelled) return;
          const count = reqRes.data.filter((r: any) =>
            (currentUser.role === 'supervisor' && r.status === 'pending_supervisor') ||
            (currentUser.role === 'accounting' && r.status === 'pending_accounting')
          ).length;
          setPendingApprovalsCount(count);
        } else {
          setPendingApprovalsCount(0);
        }
      } catch {
        if (!cancelled) { localStorage.removeItem('token'); navigate('/login'); }
      }
    };

    void bootstrap();
    void fetchNotifications(token);

    let channel: any;
    if (supabase) {
      channel = supabase
        .channel('layout-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => { void fetchNotifications(token); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_requests' }, () => { void bootstrap(); })
        .subscribe();
    }

    return () => {
      cancelled = true;
      if (channel) void supabase?.removeChannel(channel);
    };
  }, [navigate, fetchNotifications]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    navigate('/login');
  };

  const getNavClassName = (path: string) => location.pathname === path ? 'nav-link-accent' : 'nav-link';
  const unreadCount = notifications.filter(n => !n.is_read).length;

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'employee':
      case 'manager':
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
      case 'management':
        return (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
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
      case 'manager': return 'Manager Workspace';
      case 'supervisor': return 'Supervisor Portal';
      case 'accounting': return 'Finance Control';
      case 'management': return 'Management Executive';
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
          <p className="text-xl font-semibold text-[var(--role-text)]">Loading BMS Workspace</p>
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

  const navLinks = (
    <>
      {user.role === 'employee' ? (
        <>
          <Link to="/employee" className={getNavClassName('/employee')}>Overview</Link>
          <Link to="/requests/new" className={`${getNavClassName('/requests/new')} whitespace-nowrap`}>New Request</Link>
          <Link to="/tracker" className={getNavClassName('/tracker')}>My History</Link>
        </>
      ) : (
        <>
          <Link to="/" className={getNavClassName('/')}>Overview</Link>
          <Link to="/requests/new" className={`${getNavClassName('/requests/new')} whitespace-nowrap`}>New Request</Link>
        </>
      )}
      {(user.role === 'supervisor' || user.role === 'accounting') && (
        <Link to="/approvals" className={`${getNavClassName('/approvals')} relative whitespace-nowrap`}>
          {user.role === 'supervisor' ? 'Team Approvals' : 'Fund Releases'}
          {pendingApprovalsCount > 0 && (
            <span className="ml-1.5 inline-flex h-5 min-w-[18px] items-center justify-center rounded-full border border-[var(--role-primary)]/20 bg-[var(--role-primary)]/10 px-1 text-[10px] font-semibold text-[var(--role-primary)]">
              {pendingApprovalsCount}
            </span>
          )}
        </Link>
      )}
      {user.role !== 'employee' && user.role !== 'manager' && user.role !== 'super_admin' && (
        <Link to="/reports" className={getNavClassName('/reports')}>Analytics</Link>
      )}
      {(user.role === 'management' || user.role === 'admin' || user.role === 'super_admin') && (
        <Link to="/management" className={getNavClassName('/management')}>Management</Link>
      )}
      {(user.role === 'admin' || user.role === 'accounting') && (
        <Link to="/accounting" className={getNavClassName('/accounting')}>Accounting</Link>
      )}
      {(user.role === 'admin' || user.role === 'accounting' || user.role === 'super_admin') && (
        <Link to="/admin" className={getNavClassName('/admin')}>
          {user.role === 'accounting' ? 'Budget Matrix' : user.role === 'super_admin' ? 'Root' : 'Admin'}
        </Link>
      )}
      {(user.role === 'employee' || user.role === 'manager' || user.role === 'supervisor') && (
        <Link to="/profile" className={getNavClassName('/profile')}>Settings</Link>
      )}
    </>
  );

  return (
    <div className="app-shell" data-role={user.role}>
      <Toaster position="top-right" />
      <nav className="nav-surface relative">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 lg:px-8">
          <div className="flex items-center gap-4">
            <img
              src="/madison88-logo.png"
              alt="Madison88"
              className="h-12 w-auto rounded-xl border border-black/5 bg-white px-3 py-2 shadow-[0_8px_20px_rgba(0,0,0,0.06)]"
            />
            <div className="flex flex-col">
              <p className="text-sm font-bold text-[var(--role-text)] flex items-center gap-2">
                <span className="opacity-70">{getRoleIcon(user.role)}</span>
                <span className="hidden sm:inline">{getRoleLabel(user.role)}</span>
              </p>
              <p className="text-xs text-[var(--bms-muted)]">Welcome, {normalizeDisplayName(user.name)}</p>
            </div>
          </div>

          {/* Desktop nav */}
          <div className="hidden lg:flex flex-1 items-center justify-end gap-1 min-w-0">
            <div className="flex flex-wrap gap-1 items-center justify-end">
              <div ref={notificationRef} className="relative">
                <button
                  onClick={() => setShowNotifications(!showNotifications)}
                  className="relative rounded-full border border-[var(--role-border)] bg-[var(--role-accent)] p-2 transition hover:bg-[var(--role-accent)]/80 shrink-0"
                >
                  <svg className="h-5 w-5 text-[var(--role-primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  {unreadCount > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow-sm">
                      {unreadCount}
                    </span>
                  )}
                </button>
                {showNotifications && (
                  <div className="absolute right-0 top-12 z-50 w-80 max-h-96 overflow-y-auto rounded-2xl border border-[var(--role-border)] bg-white shadow-[0_20px_50px_rgba(0,0,0,0.15)]">
                    <div className="sticky top-0 flex items-center justify-between border-b border-black/5 bg-white p-4 rounded-t-2xl">
                      <h3 className="font-bold text-[var(--role-text)]">Notifications</h3>
                      <div className="flex items-center gap-2">
                        {unreadCount > 0 && (
                          <button onClick={markAllRead} className="text-xs font-medium text-[var(--role-primary)] hover:underline">Mark all read</button>
                        )}
                        <button onClick={() => setShowNotifications(false)} className="text-[var(--role-text)]/40 hover:text-[var(--role-text)]">
                          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <div className="divide-y divide-black/5">
                      {notifications.length === 0 ? (
                        <div className="p-6 text-center">
                          <svg className="mx-auto h-10 w-10 text-[var(--role-border)]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                          <p className="mt-2 text-sm text-[var(--bms-muted)]">No notifications yet</p>
                        </div>
                      ) : (
                        notifications.slice(0, 15).map((notification: any) => (
                          <div
                            key={notification.id}
                            className={`p-4 transition hover:bg-black/5 ${!notification.is_read ? 'bg-[var(--role-accent)]/30 border-l-2 border-l-[var(--role-primary)]' : ''}`}
                          >
                            <p className="text-sm text-[var(--role-text)]">{notification.message}</p>
                            <p className="mt-1 text-xs text-[var(--bms-muted)]">{notification.created_at ? new Date(notification.created_at).toLocaleString() : 'Just now'}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
              {navLinks}
            </div>
            <button onClick={handleLogout} className="btn-danger !rounded-full !px-4 !py-2 !text-sm ml-1">Logout</button>
          </div>

          {/* Mobile: notification bell + hamburger */}
          <div className="flex items-center gap-2 lg:hidden">
            <div ref={notificationRef} className="relative">
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className="relative rounded-full border border-[var(--role-border)] bg-[var(--role-accent)] p-2"
              >
                <svg className="h-5 w-5 text-[var(--role-primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                {unreadCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow-sm">
                    {unreadCount}
                  </span>
                )}
              </button>
              {showNotifications && (
                <div className="absolute right-0 top-12 z-50 w-80 max-h-80 overflow-y-auto rounded-2xl border border-[var(--role-border)] bg-white shadow-[0_20px_50px_rgba(0,0,0,0.15)]">
                  <div className="sticky top-0 flex items-center justify-between border-b border-black/5 bg-white p-3 rounded-t-2xl">
                    <h3 className="font-bold text-sm text-[var(--role-text)]">Notifications</h3>
                    <div className="flex items-center gap-2">
                      {unreadCount > 0 && (
                        <button onClick={markAllRead} className="text-xs font-medium text-[var(--role-primary)] hover:underline">Mark all read</button>
                      )}
                    </div>
                  </div>
                  <div className="divide-y divide-black/5">
                    {notifications.length === 0 ? (
                      <p className="p-4 text-center text-sm text-[var(--bms-muted)]">No notifications</p>
                    ) : (
                      notifications.slice(0, 10).map((n: any) => (
                        <div key={n.id} className={`p-3 text-xs ${!n.is_read ? 'bg-[var(--role-accent)]/30 border-l-2 border-l-[var(--role-primary)]' : ''}`}>
                          <p className="text-[var(--role-text)]">{n.message}</p>
                          <p className="mt-0.5 text-[var(--bms-muted)]">{n.created_at ? new Date(n.created_at).toLocaleString() : 'Just now'}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="rounded-lg border border-[var(--role-border)] bg-[var(--role-accent)] p-2"
            >
              {mobileMenuOpen ? (
                <svg className="h-5 w-5 text-[var(--role-text)]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              ) : (
                <svg className="h-5 w-5 text-[var(--role-text)]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
              )}
            </button>
          </div>
        </div>

        {/* Mobile slide-down menu */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-[var(--role-border)] bg-[var(--role-surface)] px-4 py-3 space-y-1 animate-in slide-in-from-top duration-200">
            <div className="flex flex-col gap-1">
              {navLinks}
            </div>
            <div className="pt-2 border-t border-[var(--role-border)]">
              <button onClick={handleLogout} className="btn-danger !rounded-full !px-4 !py-2 !text-sm w-full">Logout</button>
            </div>
          </div>
        )}
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
