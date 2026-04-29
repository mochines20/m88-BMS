import { FormEvent, useEffect, useMemo, useState } from 'react';
import api from '../api';
import { useNavigate } from 'react-router-dom';
import toast, { Toaster } from 'react-hot-toast';

type AuthMode = 'signin' | 'signup';

interface DepartmentOption {
  id: string;
  name: string;
  fiscal_year: number;
}

const COMPANY_EMAIL_DOMAIN = 'madison88.com';
const CANONICAL_DEPARTMENT_NAMES = [
  'Admin Department',
  'Finance Department',
  'HR Department',
  'IT Department',
  'Logistics Department',
  'Planning Department',
  'Purchasing Department'
];

const getFallbackDepartments = (): DepartmentOption[] => {
  const fiscalYear = new Date().getFullYear();

  return CANONICAL_DEPARTMENT_NAMES.map((name) => ({
    id: `canonical:${name}`,
    name,
    fiscal_year: fiscalYear
  }));
};

const Login = () => {
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSendingReset, setIsSendingReset] = useState(false);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [isLoadingDepartments, setIsLoadingDepartments] = useState(false);
  const [fullName, setFullName] = useState('');
  const [emailHandle, setEmailHandle] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [forgotEmail, setForgotEmail] = useState('');
  const navigate = useNavigate();
  const isAuthBusy = isSubmitting || isSendingReset;

  const companyEmail = useMemo(() => {
    const trimmedHandle = emailHandle.trim().toLowerCase();
    return trimmedHandle ? `${trimmedHandle}@${COMPANY_EMAIL_DOMAIN}` : '';
  }, [emailHandle]);

  useEffect(() => {
    if (mode !== 'signup') {
      return;
    }

    let isMounted = true;

    const fetchDepartments = async () => {
      setIsLoadingDepartments(true);

      try {
        const response = await api.get<DepartmentOption[]>('/api/auth/signup-departments');
        if (!isMounted) {
          return;
        }

        const nextDepartments = response.data.length > 0 ? response.data : getFallbackDepartments();
        setDepartments(nextDepartments);
        setDepartmentId((current) => current || nextDepartments[0]?.id || '');
      } catch (err: any) {
        if (isMounted) {
          const fallbackDepartments = getFallbackDepartments();
          setDepartments(fallbackDepartments);
          setDepartmentId((current) => current || fallbackDepartments[0]?.id || '');
          toast.error(err.response?.data?.error || 'Failed to load departments from the server. Showing default departments instead.');
        }
      } finally {
        if (isMounted) {
          setIsLoadingDepartments(false);
        }
      }
    };

    void fetchDepartments();

    return () => {
      isMounted = false;
    };
  }, [mode]);

  const resetSignupFields = () => {
    setFullName('');
    setEmailHandle('');
    setDepartmentId('');
    setConfirmPassword('');
  };

  const handleModeChange = (nextMode: AuthMode) => {
    setMode(nextMode);
    setPassword('');
    setShowPassword(false);
    setShowForgotPassword(false);

    if (nextMode === 'signin') {
      resetSignupFields();
    } else {
      setEmail('');
    }
  };

  const handleForgotPassword = async () => {
    const normalizedEmail = forgotEmail.trim().toLowerCase();

    if (!normalizedEmail) {
      toast.error('Enter your email first');
      return;
    }

    setIsSendingReset(true);

    try {
      const res = await api.post('/api/auth/forgot-password', { email: normalizedEmail });
      toast.success(res.data.message || 'If the email is registered, a reset link has been sent.');
      setShowForgotPassword(false);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to send reset link');
    } finally {
      setIsSendingReset(false);
    }
  };

  const handleLogin = async () => {
    setIsSubmitting(true);

    try {
      const res = await api.post('/api/auth/login', { email, password });
      localStorage.setItem('token', res.data.token);
      toast.success('Login successful!');
      await new Promise((resolve) => setTimeout(resolve, 450));
      navigate('/');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Login failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSignup = async () => {
    const trimmedName = fullName.trim();
    const normalizedEmail = companyEmail.trim().toLowerCase();

    if (!trimmedName) {
      toast.error('Name is required');
      return;
    }

    if (!emailHandle.trim()) {
      toast.error(`Enter your ${COMPANY_EMAIL_DOMAIN} email name`);
      return;
    }

    if (!departmentId) {
      toast.error('Please select a department');
      return;
    }

    if (password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }

    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await api.post('/api/auth/signup', {
        name: trimmedName,
        email: normalizedEmail,
        password,
        department_id: departmentId
      });

      localStorage.setItem('token', res.data.token);
      toast.success('Account created successfully!');
      await new Promise((resolve) => setTimeout(resolve, 450));
      navigate('/');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Sign up failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (mode === 'signin') {
      void handleLogin();
      return;
    }

    void handleSignup();
  };

  return (
    <div className="app-shell flex min-h-screen items-center justify-center px-4 py-10">
      <Toaster position="top-right" />
      {isAuthBusy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--role-text)]/10 backdrop-blur-sm">
          <div className="panel w-full max-w-sm text-center">
            <div className="mx-auto mb-5 flex items-center justify-center">
              <div className="bms-spinner" />
            </div>
            <p className="text-lg font-semibold text-[var(--role-text)]">Signing you in</p>
            <p className="mt-2 text-sm text-[var(--role-text)]/70">Please wait while we secure your session.</p>
            <div className="mt-6 space-y-3">
              <div className="bms-shimmer h-3 w-full rounded-full" />
              <div className="bms-shimmer h-3 w-10/12 rounded-full" />
              <div className="bms-shimmer h-3 w-8/12 rounded-full" />
            </div>
          </div>
        </div>
      )}
      <div className="grid w-full max-w-6xl gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="hidden rounded-[36px] border border-[var(--role-border)] bg-[var(--role-accent)]/50 p-10 backdrop-blur-xl lg:block">
          <img
            src="/madison88-logo.png"
            alt="Madison88"
            className="h-16 w-auto rounded-2xl border border-[var(--role-border)] bg-[#f8fbff] px-4 py-3 shadow-[0_10px_28px_rgba(0,0,0,0.08)]"
            />
          <h1 className="mt-6 max-w-lg text-5xl font-bold leading-tight text-[var(--role-text)]">
            Streamline budget requests, approvals, and reporting in one secure workspace.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-[var(--role-text)]/80">
            Track every request clearly, speed up approvals, and keep your team aligned with a more organized budgeting system.
          </p>
          <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="group panel-muted hover:border-[var(--role-primary)]/30">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--role-secondary)]/20 bg-gradient-to-br from-[var(--role-primary)]/20 to-[var(--role-secondary)]/10">
                <svg className="h-5 w-5 text-[var(--role-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <p className="text-xs uppercase tracking-[0.16em] text-[var(--role-text)]/60">Request Flow</p>
              <p className="mt-2 text-lg font-semibold text-[var(--role-text)]">Submit to Release</p>
            </div>
            <div className="group panel-muted hover:border-[var(--role-primary)]/30">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--role-secondary)]/20 bg-gradient-to-br from-[var(--role-primary)]/20 to-[var(--role-secondary)]/10">
                <svg className="h-5 w-5 text-[var(--role-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <p className="text-xs uppercase tracking-[0.16em] text-[var(--role-text)]/60">Approvals</p>
              <p className="mt-2 text-lg font-semibold text-[var(--role-text)]">Supervisor + Accounting</p>
            </div>
            <div className="group panel-muted hover:border-[var(--role-primary)]/30">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--role-secondary)]/20 bg-gradient-to-br from-[var(--role-primary)]/20 to-[var(--role-secondary)]/10">
                <svg className="h-5 w-5 text-[var(--role-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <p className="text-xs uppercase tracking-[0.16em] text-[var(--role-text)]/60">Reports</p>
              <p className="mt-2 text-lg font-semibold text-[var(--role-text)]">Fast Export</p>
            </div>
          </div>
        </div>

        <div className="panel mx-auto w-full max-w-md overflow-hidden rounded-[32px] p-8 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.08)] sm:p-10">
          <div className="mb-8 text-center">
            <img
              src="/madison88-logo.png"
              alt="Madison88"
              className="mx-auto mb-5 h-14 w-auto rounded-2xl border border-[var(--role-border)] bg-white px-4 py-3 shadow-[0_8px_24px_rgba(0,0,0,0.06)]"
            />
            <div className="mx-auto mb-5 inline-flex rounded-full border border-[var(--role-border)] bg-[var(--role-accent)] p-1">
              <button
                type="button"
                onClick={() => handleModeChange('signin')}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${mode === 'signin' ? 'bg-[var(--role-primary)] text-white shadow-md' : 'text-[var(--role-text)]/60 hover:text-[var(--role-text)]'}`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => handleModeChange('signup')}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${mode === 'signup' ? 'bg-[var(--role-primary)] text-white shadow-md' : 'text-[var(--role-text)]/60 hover:text-[var(--role-text)]'}`}
              >
                Sign Up
              </button>
            </div>
            <h1 className="text-3xl font-semibold text-[var(--role-text)]">{mode === 'signin' ? 'Sign In' : 'Create Account'}</h1>
            <p className="mt-2 text-sm text-[var(--role-text)]/78">
              {mode === 'signin'
                ? 'Access the Madison88 Budget Management System.'
                : 'Register with your Madison88 email and assigned department.'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {mode === 'signup' && (
              <>
                <div>
                  <label className="field-label">Full Name</label>
                  <input
                    type="text"
                    placeholder="Juan Dela Cruz"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="field-input"
                    required
                  />
                </div>

                <div>
                  <label className="field-label">Company Email</label>
                  <div className="field-input flex items-center gap-2 pr-4">
                    <input
                      type="text"
                      placeholder="juan.dela.cruz"
                      value={emailHandle}
                      onChange={(e) => setEmailHandle(e.target.value.replace(/\s+/g, ''))}
                      className="min-w-0 flex-1 bg-transparent text-[var(--role-text)] outline-none placeholder:text-[var(--role-text)]/40"
                      required
                    />
                    <span className="shrink-0 text-sm text-[var(--role-text)]/70">@{COMPANY_EMAIL_DOMAIN}</span>
                  </div>
                  <p className="mt-2 text-xs text-[var(--role-text)]/58">
                    Final email: {companyEmail || `your.name@${COMPANY_EMAIL_DOMAIN}`}
                  </p>
                </div>

                <div>
                  <label className="field-label">Department</label>
                  <select
                    value={departmentId}
                    onChange={(e) => setDepartmentId(e.target.value)}
                    className="field-input"
                    required
                    disabled={isLoadingDepartments}
                  >
                    <option value="">{isLoadingDepartments ? 'Loading departments...' : 'Select your department'}</option>
                    {departments.map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.name}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            <div className="relative">
              <label className="field-label">Email</label>
              <div className="relative">
                <input
                  type="email"
                  placeholder={`admin@${COMPANY_EMAIL_DOMAIN}`}
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (!forgotEmail) {
                      setForgotEmail(e.target.value);
                    }
                  }}
                  className="field-input pr-12"
                  required
                />
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4">
                  <svg className="h-5 w-5 text-[var(--role-text)]/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                  </svg>
                </div>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="field-label !mb-0">Password</label>
                {mode === 'signin' && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowForgotPassword((current) => !current);
                      setForgotEmail((current) => current || email);
                    }}
                    className="text-xs font-medium text-[var(--role-secondary)] transition hover:text-[var(--role-primary)]"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder={mode === 'signin' ? 'Enter your password' : 'Create a password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="field-input pr-12"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-4 text-[var(--role-text)]/60 transition hover:text-[var(--role-primary)]"
                >
                  {showPassword ? (
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {mode === 'signin' && showForgotPassword && (
              <div className="rounded-2xl border border-[var(--role-secondary)]/22 bg-[var(--role-accent)] p-4">
                <label className="field-label">Reset Email</label>
                <input
                  type="email"
                  placeholder={`admin@${COMPANY_EMAIL_DOMAIN}`}
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  className="field-input"
                />
                <p className="mt-2 text-xs text-[var(--role-text)]/60">
                  We’ll check the email against the users table and send a reset link if it exists.
                </p>
                <button
                  type="button"
                  onClick={() => void handleForgotPassword()}
                  disabled={isSendingReset}
                  className="mt-4 w-full rounded-2xl border border-[var(--role-secondary)]/32 bg-[var(--role-secondary)]/14 px-4 py-3 text-sm font-semibold text-[var(--role-primary)] transition hover:bg-[var(--role-secondary)]/20 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isSendingReset ? 'Sending reset link...' : 'Send Reset Link'}
                </button>
              </div>
            )}

            {mode === 'signup' && (
              <div className="relative">
                <label className="field-label">Confirm Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Re-enter your password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="field-input pr-12"
                    required
                  />
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4">
                    <svg className="h-5 w-5 text-[var(--role-text)]/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  </div>
                </div>
              </div>
            )}

            <div className="relative pt-2">
              <button
                type="submit"
                className="btn-primary group relative w-full overflow-hidden"
                disabled={isSubmitting || (mode === 'signup' && isLoadingDepartments)}
              >
                <span className={`relative z-10 flex items-center justify-center gap-2 transition-opacity ${isSubmitting ? 'opacity-0' : 'opacity-100'}`}>
                  {mode === 'signin' ? (
                    <>
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                      </svg>
                      Login
                    </>
                  ) : (
                    <>
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                      </svg>
                      Create Account
                    </>
                  )}
                </span>
                {isSubmitting && (
                  <span className="absolute inset-0 flex items-center justify-center">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  </span>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Login;
