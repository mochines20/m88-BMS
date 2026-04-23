import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { supabase } from '../utils/supabase';
import { authenticate } from '../middleware/auth';
import { sendEmail } from '../utils/email';

const router = express.Router();
const COMPANY_EMAIL_DOMAIN = 'madison88.com';
const normalizeDepartmentName = (value: string) => String(value || '').trim();
const normalizeDepartmentKey = (value: string) => normalizeDepartmentName(value).toLowerCase();
const LEGACY_TO_CANONICAL_DEPARTMENT: Record<string, string> = {
  m88it: 'IT Department',
  m88purchasing: 'Purchasing Department',
  m88planning: 'Planning Department',
  m88logistics: 'Logistics Department',
  m88hr: 'HR Department',
  m88accounting: 'Finance Department',
  m88admin: 'Admin Department',
  'accounting department': 'Finance Department'
};
const CANONICAL_DEPARTMENTS = [
  'Admin Department',
  'Finance Department',
  'HR Department',
  'IT Department',
  'Logistics Department',
  'Planning Department',
  'Purchasing Department'
];
const toCanonicalDepartmentName = (value: string) => {
  const normalizedValue = normalizeDepartmentName(value);
  if (!normalizedValue) return '';
  return LEGACY_TO_CANONICAL_DEPARTMENT[normalizeDepartmentKey(normalizedValue)] || normalizedValue;
};
const PASSWORD_RESET_TOKEN_TTL_MINUTES = Number(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES || 30);
const PASSWORD_RESET_RESEND_COOLDOWN_SECONDS = Number(process.env.PASSWORD_RESET_RESEND_COOLDOWN_SECONDS || 60);
const normalizeEmail = (value?: string) => String(value || '').trim().toLowerCase();
const getAppUrl = (origin?: string | string[]) => {
  const normalizedOrigin = Array.isArray(origin) ? origin[0] : origin;
  const explicitUrl = String(process.env.APP_URL || process.env.PUBLIC_APP_URL || '').trim();
  const fallbackUrl = normalizedOrigin && /^https?:\/\//i.test(normalizedOrigin) ? normalizedOrigin : 'http://localhost:5173';
  return (explicitUrl || fallbackUrl).replace(/\/+$/, '');
};
const buildResetPasswordEmail = (name: string, resetUrl: string) => {
  const greetingName = name || 'there';

  return {
    text: `Hello ${greetingName},\n\nWe received a request to reset your Madison88 password.\n\nUse this link to create a new password:\n${resetUrl}\n\nThis link expires in ${PASSWORD_RESET_TOKEN_TTL_MINUTES} minutes.\nIf you did not request this, you can ignore this email.`,
    html: `
      <div style="margin:0;padding:32px 16px;background:#eef3fb;font-family:Segoe UI,Arial,sans-serif;color:#13213d;">
        <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid #d9e1f1;">
          <div style="padding:32px;background:linear-gradient(135deg,#1e2b4a 0%,#2d416d 100%);text-align:center;">
            <img src="https://hjjpqwzmrnjquneuppeb.supabase.co/storage/v1/object/public/public-assets/madison88-logo.png" alt="Madison88" style="max-width:180px;height:auto;background:#f8fbff;padding:12px 18px;border-radius:18px;" />
            <h1 style="margin:24px 0 0;font-size:28px;line-height:1.2;color:#ffffff;">Reset Your Password</h1>
          </div>
          <div style="padding:32px;">
            <p style="margin:0 0 16px;font-size:16px;line-height:1.7;">Hello ${greetingName},</p>
            <p style="margin:0 0 16px;font-size:16px;line-height:1.7;">We received a request to reset your Madison88 Budget Management System password.</p>
            <p style="margin:0 0 28px;font-size:16px;line-height:1.7;">Click the button below to open the system and choose a new password.</p>
            <div style="text-align:center;margin:0 0 28px;">
              <a href="${resetUrl}" style="display:inline-block;background:#38558c;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:14px 28px;border-radius:14px;">Reset Password</a>
            </div>
            <div style="margin:0 0 24px;padding:16px 18px;background:#f6f8fc;border:1px solid #d9e1f1;border-radius:16px;">
              <p style="margin:0 0 8px;font-size:14px;color:#4b5b7c;">If the button does not work, copy and open this link:</p>
              <p style="margin:0;word-break:break-all;font-size:14px;"><a href="${resetUrl}" style="color:#38558c;">${resetUrl}</a></p>
            </div>
            <p style="margin:0 0 10px;font-size:14px;line-height:1.7;color:#5f6f90;">This link expires in ${PASSWORD_RESET_TOKEN_TTL_MINUTES} minutes.</p>
            <p style="margin:0;font-size:14px;line-height:1.7;color:#5f6f90;">If you did not request this, you can safely ignore this email.</p>
          </div>
        </div>
      </div>
    `
  };
};
const getPasswordResetSecret = () => process.env.JWT_SECRET || 'change-me';
const getPasswordResetExpirySeconds = (expiresAt: string) => Math.floor(new Date(expiresAt).getTime() / 1000);
const buildPasswordResetToken = (resetToken: { id: string; user_id: string; expires_at: string }) =>
  jwt.sign(
    {
      sub: resetToken.user_id,
      jti: resetToken.id,
      type: 'password_reset',
      exp: getPasswordResetExpirySeconds(resetToken.expires_at)
    },
    getPasswordResetSecret(),
    {
      algorithm: 'HS256',
      noTimestamp: true
    }
  );
const getPasswordResetTokenHash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
const getPasswordResetCooldownMessage = () => 'A reset link was already sent recently. Please check your latest email.';
const getPasswordResetSentMessage = () => 'If the email is registered, a password reset link has been sent.';
const getActiveResetTokenForUser = async (userId: string) => {
  const { data, error } = await supabase
    .from('password_reset_tokens')
    .select('id, user_id, token_hash, expires_at, used_at, invalidated_at, invalidation_reason, created_at')
    .eq('user_id', userId)
    .is('used_at', null)
    .is('invalidated_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1);

  return {
    data: data?.[0] || null,
    error
  };
};
const wasPasswordResetLinkSentRecently = (lastSentAt?: string | null) => {
  if (!lastSentAt) return false;
  return Date.now() - new Date(lastSentAt).getTime() < PASSWORD_RESET_RESEND_COOLDOWN_SECONDS * 1000;
};

const getSignupDepartments = async () => {
  const { data, error } = await supabase
    .from('departments')
    .select('id, name, fiscal_year, created_at, updated_at')
    .order('fiscal_year', { ascending: false })
    .order('updated_at', { ascending: false });

  if (error) {
    return { data: null, error };
  }

  if (!data || data.length === 0) {
    return {
      data: CANONICAL_DEPARTMENTS.map((name) => ({
        id: `canonical:${name}`,
        name,
        fiscal_year: new Date().getFullYear()
      })),
      error: null
    };
  }

  const latestDepartmentsByName = new Map<string, any>();

  (data || []).forEach((department) => {
    const canonicalName = toCanonicalDepartmentName(department.name);
    const key = normalizeDepartmentKey(canonicalName);
    const current = latestDepartmentsByName.get(key);
    const candidate = {
      ...department,
      name: canonicalName
    };

    if (!current) {
      latestDepartmentsByName.set(key, candidate);
      return;
    }

    const currentUpdatedAt = new Date(current.updated_at || current.created_at || 0).getTime();
    const candidateUpdatedAt = new Date(candidate.updated_at || candidate.created_at || 0).getTime();

    if (candidateUpdatedAt >= currentUpdatedAt) {
      latestDepartmentsByName.set(key, candidate);
    }
  });

  return {
    data: Array.from(latestDepartmentsByName.values()).sort((left, right) => left.name.localeCompare(right.name)),
    error: null
  };
};

const resolveSignupDepartment = async (departmentIdOrName: string) => {
  const normalizedValue = normalizeDepartmentName(departmentIdOrName);

  if (!normalizedValue) {
    return { data: null, error: 'Selected department was not found.' };
  }

  if (!normalizedValue.startsWith('canonical:')) {
    const { data: departmentById, error: departmentByIdError } = await supabase
      .from('departments')
      .select('id, name, fiscal_year')
      .eq('id', normalizedValue)
      .single();

    if (!departmentByIdError && departmentById) {
      return { data: departmentById, error: null };
    }
  }

  const canonicalName = toCanonicalDepartmentName(normalizedValue.startsWith('canonical:')
    ? normalizeDepartmentName(normalizedValue.slice('canonical:'.length))
    : normalizedValue);

  const { data: matchedDepartments, error: matchedDepartmentsError } = await supabase
    .from('departments')
    .select('id, name, fiscal_year, updated_at, created_at')
    .ilike('name', canonicalName)
    .order('fiscal_year', { ascending: false })
    .order('updated_at', { ascending: false });

  if (matchedDepartmentsError) {
    return { data: null, error: matchedDepartmentsError.message || 'Selected department was not found.' };
  }

  if (matchedDepartments && matchedDepartments.length > 0) {
    return { data: matchedDepartments[0], error: null };
  }

  if (!CANONICAL_DEPARTMENTS.includes(canonicalName)) {
    return { data: null, error: 'Selected department was not found.' };
  }

  const { data: createdDepartment, error: createDepartmentError } = await supabase
    .from('departments')
    .insert({
      name: canonicalName,
      annual_budget: 0,
      fiscal_year: new Date().getFullYear(),
      updated_at: new Date()
    })
    .select('id, name, fiscal_year')
    .single();

  if (createDepartmentError || !createdDepartment) {
    return { data: null, error: createDepartmentError?.message || 'Selected department was not found.' };
  }

  return { data: createdDepartment, error: null };
};

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { password } = req.body;
  const email = normalizeEmail(req.body?.email);
  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .single();
  if (error || !user) return res.status(400).json({ error: 'Invalid credentials' });
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(400).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user.id, role: user.role, department_id: user.department_id }, process.env.JWT_SECRET!, { expiresIn: '1h' });
  res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  const email = normalizeEmail(req.body?.email);

  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('id, name, email')
    .eq('email', email)
    .maybeSingle();

  if (error) {
    return res.status(400).json({ error: error.message || 'Unable to process password reset.' });
  }

  if (!user) {
    return res.json({
      message: getPasswordResetSentMessage()
    });
  }
  const { data: activeResetToken, error: activeResetTokenError } = await getActiveResetTokenForUser(user.id);

  if (activeResetTokenError) {
    return res.status(400).json({ error: activeResetTokenError.message || 'Unable to process password reset.' });
  }

  if (activeResetToken) {
    if (wasPasswordResetLinkSentRecently(activeResetToken.created_at)) {
      return res.json({ message: getPasswordResetCooldownMessage() });
    }

    const rawToken = buildPasswordResetToken(activeResetToken);
    const resetUrl = `${getAppUrl(req.headers.origin)}/reset-password?token=${rawToken}`;
    const emailContent = buildResetPasswordEmail(user.name || 'there', resetUrl);

    try {
      await sendEmail(
        user.email,
        'Reset your Madison88 password',
        emailContent.text,
        emailContent.html
      );
    } catch (error: any) {
      return res.status(400).json({ error: error?.message || 'Failed to send reset email.' });
    }

    return res.json({ message: getPasswordResetSentMessage() });
  }

  await supabase
    .from('password_reset_tokens')
    .update({
      invalidated_at: new Date().toISOString(),
      invalidation_reason: 'superseded'
    })
    .eq('user_id', user.id)
    .is('used_at', null)
    .is('invalidated_at', null);

  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MINUTES * 60 * 1000).toISOString();
  const { data: createdResetToken, error: insertError } = await supabase
    .from('password_reset_tokens')
    .insert({
      user_id: user.id,
      token_hash: 'pending',
      expires_at: expiresAt
    })
    .select('id, user_id, expires_at')
    .single();

  if (insertError || !createdResetToken) {
    return res.status(400).json({ error: insertError?.message || 'Unable to create password reset token.' });
  }

  const rawToken = buildPasswordResetToken(createdResetToken);
  const tokenHash = getPasswordResetTokenHash(rawToken);
  const { error: updateResetTokenError } = await supabase
    .from('password_reset_tokens')
    .update({ token_hash: tokenHash })
    .eq('id', createdResetToken.id);

  if (updateResetTokenError) {
    return res.status(400).json({ error: updateResetTokenError.message || 'Unable to finalize password reset token.' });
  }

  const resetUrl = `${getAppUrl(req.headers.origin)}/reset-password?token=${rawToken}`;
  const emailContent = buildResetPasswordEmail(user.name || 'there', resetUrl);

  try {
    await sendEmail(
      user.email,
      'Reset your Madison88 password',
      emailContent.text,
      emailContent.html
    );
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || 'Failed to send reset email.' });
  }

  return res.json({ message: getPasswordResetSentMessage() });
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const token = String(req.body?.token || '').trim();
  const password = String(req.body?.password || '');

  if (!token || !password) {
    return res.status(400).json({ error: 'Reset token and new password are required.' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
  }

  const tokenHash = getPasswordResetTokenHash(token);
  let decodedToken: jwt.JwtPayload;

  try {
    decodedToken = jwt.verify(token, getPasswordResetSecret()) as jwt.JwtPayload;
  } catch (error: any) {
    if (error?.name === 'TokenExpiredError') {
      return res.status(400).json({ error: 'This password reset link has expired.' });
    }

    return res.status(400).json({ error: 'This password reset link is invalid.' });
  }

  if (decodedToken.type !== 'password_reset' || !decodedToken.jti || !decodedToken.sub) {
    return res.status(400).json({ error: 'This password reset link is invalid.' });
  }

  const { data: resetToken, error: resetTokenError } = await supabase
    .from('password_reset_tokens')
    .select('id, user_id, token_hash, expires_at, used_at, invalidated_at, invalidation_reason')
    .eq('id', String(decodedToken.jti))
    .maybeSingle();

  if (resetTokenError) {
    return res.status(400).json({ error: resetTokenError.message || 'Invalid password reset token.' });
  }

  if (!resetToken) {
    return res.status(400).json({ error: 'This password reset link is invalid.' });
  }

  if (resetToken.user_id !== String(decodedToken.sub) || resetToken.token_hash !== tokenHash) {
    return res.status(400).json({ error: 'This password reset link is invalid.' });
  }

  if (resetToken.invalidated_at && resetToken.invalidation_reason === 'superseded') {
    return res.status(400).json({ error: 'A newer password reset link was already requested. Please use the latest email.' });
  }

  if (resetToken.used_at) {
    return res.status(400).json({ error: 'This password reset link was already used.' });
  }

  if (new Date(resetToken.expires_at).getTime() < Date.now()) {
    return res.status(400).json({ error: 'This password reset link has expired.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const { error: updateUserError } = await supabase
    .from('users')
    .update({
      password_hash: passwordHash,
      updated_at: new Date().toISOString()
    })
    .eq('id', resetToken.user_id);

  if (updateUserError) {
    return res.status(400).json({ error: updateUserError.message || 'Failed to reset password.' });
  }

  await supabase
    .from('password_reset_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', resetToken.id);

  await supabase.from('password_reset_tokens').delete().eq('user_id', resetToken.user_id).neq('id', resetToken.id);

  return res.json({ message: 'Password reset successful. You can now sign in with your new password.' });
});

// GET /api/auth/signup-departments
router.get('/signup-departments', async (_req, res) => {
  const { data, error } = await getSignupDepartments();
  if (error) return res.status(400).json({ error });
  res.json(data);
});

// PATCH /api/auth/profile
router.patch('/profile', authenticate, async (req: any, res) => {
  if (req.user.role !== 'employee' && req.user.role !== 'supervisor') {
    return res.status(403).json({ error: 'Only employees and supervisors can update their own department.' });
  }

  const { name, department_id } = req.body as {
    name?: string;
    department_id?: string;
  };

  const normalizedName = String(name || '').trim();
  const normalizedDepartmentId = String(department_id || '').trim();

  if (!normalizedName || !normalizedDepartmentId) {
    return res.status(400).json({ error: 'Name and department are required.' });
  }

  const { data: department, error: departmentError } = await resolveSignupDepartment(normalizedDepartmentId);
  if (departmentError || !department) {
    return res.status(400).json({ error: departmentError || 'Selected department was not found.' });
  }

  const { data: updatedUser, error } = await supabase
    .from('users')
    .update({
      name: normalizedName,
      department_id: department.id,
      updated_at: new Date()
    })
    .eq('id', req.user.id)
    .select('id, name, email, role, department_id')
    .single();

  if (error || !updatedUser) {
    return res.status(400).json({ error: error || 'Failed to update profile' });
  }

  await Promise.all([
    supabase
      .from('expense_requests')
      .update({
        department_id: department.id,
        updated_at: new Date()
      })
      .eq('employee_id', req.user.id),
    supabase
      .from('direct_expenses')
      .update({
        department_id: department.id
      })
      .eq('logged_by', req.user.id)
  ]);

  const token = jwt.sign(
    { id: updatedUser.id, role: updatedUser.role, department_id: updatedUser.department_id },
    process.env.JWT_SECRET!,
    { expiresIn: '1h' }
  );

  res.json({
    token,
    user: updatedUser
  });
});

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  const { name, email, password, department_id } = req.body as {
    name?: string;
    email?: string;
    password?: string;
    department_id?: string;
  };

  const normalizedName = String(name || '').trim();
  const normalizedEmail = normalizeEmail(email);
  const normalizedPassword = String(password || '');
  const normalizedDepartmentId = String(department_id || '').trim();

  if (!normalizedName || !normalizedEmail || !normalizedPassword || !normalizedDepartmentId) {
    return res.status(400).json({ error: 'Name, company email, password, and department are required.' });
  }

  if (!normalizedEmail.endsWith(`@${COMPANY_EMAIL_DOMAIN}`)) {
    return res.status(400).json({ error: `Please use your @${COMPANY_EMAIL_DOMAIN} company email.` });
  }

  if (normalizedPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
  }

  const { data: department, error: departmentError } = await resolveSignupDepartment(normalizedDepartmentId);

  if (departmentError || !department) {
    return res.status(400).json({ error: departmentError || 'Selected department was not found.' });
  }

  const { data: existingUser, error: existingUserError } = await supabase
    .from('users')
    .select('id')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (existingUserError) return res.status(400).json({ error: existingUserError });
  if (existingUser) return res.status(409).json({ error: 'This email is already registered.' });

  const password_hash = await bcrypt.hash(normalizedPassword, 10);

  const { data: newUser, error: insertError } = await supabase
    .from('users')
    .insert({
      name: normalizedName,
      email: normalizedEmail,
      password_hash,
      role: 'employee',
      department_id: department.id,
      updated_at: new Date()
    })
    .select('id, name, role, department_id')
    .single();

  if (insertError || !newUser) return res.status(400).json({ error: insertError || 'Failed to create account' });

  const token = jwt.sign(
    { id: newUser.id, role: newUser.role, department_id: newUser.department_id },
    process.env.JWT_SECRET!,
    { expiresIn: '1h' }
  );

  res.status(201).json({
    token,
    user: {
      id: newUser.id,
      name: newUser.name,
      role: newUser.role
    }
  });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.json({ message: 'Logged out' });
});

// GET /api/auth/me
router.get('/me', authenticate, async (req: any, res) => {
  const { data: user, error } = await supabase
    .from('users')
    .select('id, name, email, role, department_id')
    .eq('id', req.user.id)
    .single();
  if (error) return res.status(400).json({ error });
  res.json(user);
});

export default router;
