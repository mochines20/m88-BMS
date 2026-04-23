import { FormEvent, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast, { Toaster } from 'react-hot-toast';
import api from '../api';

const ResetPassword = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = useMemo(() => searchParams.get('token') || '', [searchParams]);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!token) {
      toast.error('Reset token is missing from the link.');
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
      const res = await api.post('/api/auth/reset-password', { token, password });
      toast.success(res.data.message || 'Password reset successful');
      navigate('/login');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to reset password');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="app-shell flex min-h-screen items-center justify-center px-4 py-10">
      <Toaster position="top-right" />
      <div className="panel mx-auto w-full max-w-md rounded-[32px] p-8 sm:p-10">
        <div className="mb-8 text-center">
          <img
            src="/madison88-logo.png"
            alt="Madison88"
            className="mx-auto mb-5 h-14 w-auto rounded-2xl border border-[#D9E1F1]/40 bg-[#f8fbff] px-4 py-3 shadow-[0_10px_28px_rgba(5,10,20,0.2)]"
          />
          <h1 className="text-3xl font-semibold text-white">Reset Password</h1>
          <p className="mt-2 text-sm text-[#D9E1F1]/78">
            Create a new password for your Madison88 account.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="field-label !mb-0">New Password</label>
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                className="text-sm text-[#D9E1F1]/78 transition hover:text-white"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Create a new password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="field-input"
              required
            />
          </div>

          <div>
            <label className="field-label">Confirm Password</label>
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Re-enter your new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="field-input"
              required
            />
          </div>

          <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Resetting password...' : 'Reset Password'}
          </button>

          <button
            type="button"
            onClick={() => navigate('/login')}
            className="w-full text-sm text-[#D9E1F1]/78 transition hover:text-white"
          >
            Back to Sign In
          </button>
        </form>
      </div>
    </div>
  );
};

export default ResetPassword;
