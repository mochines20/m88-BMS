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
      <div className="grid w-full max-w-6xl gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="hidden rounded-[36px] border border-white/10 bg-white/5 p-10 backdrop-blur-xl lg:block">
          <img
            src="/madison88-logo.png"
            alt="Madison88"
            className="h-16 w-auto rounded-2xl border border-[#D9E1F1]/40 bg-[#f8fbff] px-4 py-3 shadow-[0_10px_28px_rgba(5,10,20,0.22)]"
          />
          <h1 className="mt-6 max-w-lg text-5xl font-bold leading-tight text-white">
            Streamline budget requests, approvals, and reporting in one secure workspace.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-[#D9E1F1]/80">
            Track every request clearly, speed up approvals, and keep your team aligned with a more organized budgeting system.
          </p>
          <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="panel-muted">
              <p className="text-xs uppercase tracking-[0.16em] text-[#D9E1F1]/60">Request Flow</p>
              <p className="mt-2 text-lg font-semibold text-white">Submit to Release</p>
            </div>
            <div className="panel-muted">
              <p className="text-xs uppercase tracking-[0.16em] text-[#D9E1F1]/60">Approvals</p>
              <p className="mt-2 text-lg font-semibold text-white">Supervisor + Accounting</p>
            </div>
            <div className="panel-muted">
              <p className="text-xs uppercase tracking-[0.16em] text-[#D9E1F1]/60">Reports</p>
              <p className="mt-2 text-lg font-semibold text-white">Fast Export</p>
            </div>
          </div>
        </div>

        <div className="panel mx-auto w-full max-w-md overflow-hidden rounded-[32px] p-8 sm:p-10">
          <div className="mb-8 text-center">
            <img
              src="/madison88-logo.png"
              alt="Madison88"
              className="mx-auto mb-5 h-14 w-auto rounded-2xl border border-[#D9E1F1]/40 bg-[#f8fbff] px-4 py-3 shadow-[0_10px_28px_rgba(5,10,20,0.2)]"
            />
            <div className="mx-auto mb-5 inline-flex rounded-full border border-white/10 bg-white/5 p-1">
              <button
                type="button"
                onClick={() => handleModeChange('signin')}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${mode === 'signin' ? 'bg-[#8FB3E2] text-[#13213d]' : 'text-[#D9E1F1]/78 hover:text-white'}`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => handleModeChange('signup')}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${mode === 'signup' ? 'bg-[#8FB3E2] text-[#13213d]' : 'text-[#D9E1F1]/78 hover:text-white'}`}
              >
                Sign Up
              </button>
            </div>
            <h1 className="text-3xl font-semibold text-white">{mode === 'signin' ? 'Sign In' : 'Create Account'}</h1>
            <p className="mt-2 text-sm text-[#D9E1F1]/78">
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
                      className="min-w-0 flex-1 bg-transparent text-white outline-none placeholder:text-[#D9E1F1]/40"
                      required
                    />
                    <span className="shrink-0 text-sm text-[#D9E1F1]/70">@{COMPANY_EMAIL_DOMAIN}</span>
                  </div>
                  <p className="mt-2 text-xs text-[#D9E1F1]/58">
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

            {mode === 'signin' && (
              <div>
                <label className="field-label">Email</label>
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
                  className="field-input"
                  required
                />
              </div>
            )}

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="field-label !mb-0">Password</label>
                <div className="flex items-center gap-4">
                  {mode === 'signin' && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowForgotPassword((current) => !current);
                        setForgotEmail((current) => current || email);
                      }}
                      className="text-sm text-[#8FB3E2] transition hover:text-white"
                    >
                      Forgot password?
                    </button>
                  )}
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="text-sm text-[#D9E1F1]/78 transition hover:text-white">
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder={mode === 'signin' ? 'Enter your password' : 'Create a password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="field-input"
                required
              />
            </div>

            {mode === 'signin' && showForgotPassword && (
              <div className="rounded-2xl border border-[#8FB3E2]/25 bg-white/5 p-4">
                <label className="field-label">Reset Email</label>
                <input
                  type="email"
                  placeholder={`admin@${COMPANY_EMAIL_DOMAIN}`}
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  className="field-input"
                />
                <p className="mt-2 text-xs text-[#D9E1F1]/60">
                  We’ll check the email against the users table and send a reset link if it exists.
                </p>
                <button
                  type="button"
                  onClick={() => void handleForgotPassword()}
                  disabled={isSendingReset}
                  className="mt-4 w-full rounded-2xl border border-[#8FB3E2]/35 bg-[#8FB3E2]/16 px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#8FB3E2]/22 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isSendingReset ? 'Sending reset link...' : 'Send Reset Link'}
                </button>
              </div>
            )}

            {mode === 'signup' && (
              <div>
                <label className="field-label">Confirm Password</label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Re-enter your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="field-input"
                  required
                />
              </div>
            )}

            <button type="submit" className="btn-primary w-full" disabled={isSubmitting || (mode === 'signup' && isLoadingDepartments)}>
              {isSubmitting ? (mode === 'signin' ? 'Signing in...' : 'Creating account...') : mode === 'signin' ? 'Login' : 'Create Account'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Login;
