const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { sendEmail } = require('./netlify/functions/utils/email');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Supabase setup (using environment variables or defaults for local dev)
const supabaseUrl = process.env.SUPABASE_URL || 'https://hjjpqwzmrnjquneuppeb.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_ANON_KEY || 'sb_publishable_4OT_XzItsdRNe8Jtm43nGg_-gT8fLru';
const supabase = createClient(supabaseUrl, supabaseKey);

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key_here';

// Auth middleware
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Access denied' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

const authorize = (roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
};

const toNumber = (value) => Number.parseFloat(value ?? 0) || 0;
const normalizeDepartmentName = (value) => String(value || '').trim();
const normalizeDepartmentKey = (value) => normalizeDepartmentName(value).toLowerCase();
const LEGACY_TO_CANONICAL_DEPARTMENT = {
  m88it: 'IT Department',
  m88purchasing: 'Purchasing Department',
  m88planning: 'Planning Department',
  m88logistics: 'Logistics Department',
  m88hr: 'HR Department',
  m88accounting: 'Finance Department',
  m88admin: 'Admin Department',
  'accounting department': 'Finance Department'
};
const isBudgetCommittedStatus = (status) => status === 'released' || status === 'approved';
const COMPANY_EMAIL_DOMAIN = 'madison88.com';
const CANONICAL_DEPARTMENTS = [
  'Admin Department',
  'Finance Department',
  'HR Department',
  'IT Department',
  'Logistics Department',
  'Planning Department',
  'Purchasing Department'
];
const toCanonicalDepartmentName = (value) => {
  const normalizedValue = normalizeDepartmentName(value);
  if (!normalizedValue) return '';
  return LEGACY_TO_CANONICAL_DEPARTMENT[normalizeDepartmentKey(normalizedValue)] || normalizedValue;
};
const PASSWORD_RESET_TOKEN_TTL_MINUTES = Number(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES || 30);
const PASSWORD_RESET_RESEND_COOLDOWN_SECONDS = Number(process.env.PASSWORD_RESET_RESEND_COOLDOWN_SECONDS || 60);
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const getAppUrl = (origin) => {
  const explicitUrl = String(process.env.APP_URL || process.env.PUBLIC_APP_URL || '').trim();
  const fallbackUrl = origin && /^https?:\/\//i.test(origin) ? origin : 'http://localhost:5173';
  return (explicitUrl || fallbackUrl).replace(/\/+$/, '');
};
const buildResetPasswordEmail = (name, resetUrl) => {
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
const getPasswordResetExpirySeconds = (expiresAt) => Math.floor(new Date(expiresAt).getTime() / 1000);
const buildPasswordResetToken = (resetToken) =>
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
const getPasswordResetTokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const getPasswordResetCooldownMessage = () => 'A reset link was already sent recently. Please check your latest email.';
const getPasswordResetSentMessage = () => 'If the email is registered, a password reset link has been sent.';
const REQUEST_RELATIONS_SELECT = `
  *,
  users:users!fk_expense_requests_employee_id(name),
  departments:departments!fk_expense_requests_department_id(name, fiscal_year)
`;
const REQUESTS_REPORT_SELECT = `
  *,
  users:users!fk_expense_requests_employee_id(name),
  departments:departments!fk_expense_requests_department_id(name, fiscal_year)
`;
const getActiveResetTokenForUser = async (userId) => {
  const { data, error } = await supabase
    .from('password_reset_tokens')
    .select('id, user_id, token_hash, expires_at, last_sent_at, used_at, invalidated_at, invalidation_reason, created_at')
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
const wasPasswordResetLinkSentRecently = (lastSentAt) => {
  if (!lastSentAt) return false;
  return Date.now() - new Date(lastSentAt).getTime() < PASSWORD_RESET_RESEND_COOLDOWN_SECONDS * 1000;
};

const getSignupDepartments = async () => {
  const activeFiscalYear = await getLatestConfiguredFiscalYear();
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
        fiscal_year: activeFiscalYear
      })),
      error: null
    };
  }

  const latestDepartmentsByName = new Map();
  data.forEach((department) => {
    const canonicalName = toCanonicalDepartmentName(department.name);
    const key = normalizeDepartmentKey(canonicalName);
    const candidate = {
      ...department,
      name: canonicalName
    };
    const current = latestDepartmentsByName.get(key);
    latestDepartmentsByName.set(
      key,
      current ? pickMostRelevantDepartment([current, candidate], activeFiscalYear) : candidate
    );
  });

  return {
    data: Array.from(latestDepartmentsByName.values()).sort((left, right) => left.name.localeCompare(right.name)),
    error: null
  };
};

const resolveSignupDepartment = async (departmentIdOrName) => {
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
  const activeFiscalYear = await getLatestConfiguredFiscalYear();

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
      fiscal_year: activeFiscalYear,
      updated_at: new Date()
    })
    .select('id, name, fiscal_year')
    .single();

  if (createDepartmentError || !createdDepartment) {
    return { data: null, error: createDepartmentError?.message || 'Selected department was not found.' };
  }

  return { data: createdDepartment, error: null };
};

const getCurrentFiscalYear = () => new Date().getFullYear();
const getLatestConfiguredFiscalYear = async (fallback = getCurrentFiscalYear()) => {
  const { data, error } = await supabase
    .from('departments')
    .select('fiscal_year')
    .order('fiscal_year', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return fallback;

  const year = Number(data?.fiscal_year || 0);
  return Number.isInteger(year) && year > 0 ? year : fallback;
};
const getDepartmentTimestamp = (department) => new Date(department?.updated_at || department?.created_at || 0).getTime();
const pickMostRelevantDepartment = (departments, preferredFiscalYear = getCurrentFiscalYear()) =>
  [...departments].sort((left, right) => {
    const leftPreferred = Number(left?.fiscal_year) === preferredFiscalYear ? 1 : 0;
    const rightPreferred = Number(right?.fiscal_year) === preferredFiscalYear ? 1 : 0;
    if (rightPreferred !== leftPreferred) return rightPreferred - leftPreferred;

    const leftYear = Number(left?.fiscal_year || 0);
    const rightYear = Number(right?.fiscal_year || 0);
    if (rightYear !== leftYear) return rightYear - leftYear;

    return getDepartmentTimestamp(right) - getDepartmentTimestamp(left);
  })[0] || null;

const resolveActiveDepartmentForDepartmentId = async (departmentId, preferredFiscalYear) => {
  const normalizedDepartmentId = String(departmentId || '').trim();
  if (!normalizedDepartmentId) {
    return { currentDepartment: null, activeDepartment: null, relatedDepartments: [] };
  }

  const { data: currentDepartment, error: currentDepartmentError } = await supabase
    .from('departments')
    .select('id, name, fiscal_year, annual_budget, used_budget, petty_cash_balance, updated_at, created_at')
    .eq('id', normalizedDepartmentId)
    .maybeSingle();

  if (currentDepartmentError || !currentDepartment) {
    return { currentDepartment: null, activeDepartment: null, relatedDepartments: [] };
  }

  const canonicalName = toCanonicalDepartmentName(currentDepartment.name);
  const { data: relatedDepartments, error: relatedDepartmentsError } = await supabase
    .from('departments')
    .select('id, name, fiscal_year, annual_budget, used_budget, petty_cash_balance, updated_at, created_at')
    .ilike('name', canonicalName)
    .order('fiscal_year', { ascending: false })
    .order('updated_at', { ascending: false });

  if (relatedDepartmentsError || !relatedDepartments?.length) {
    return {
      currentDepartment,
      activeDepartment: currentDepartment,
      relatedDepartments: currentDepartment ? [currentDepartment] : []
    };
  }

  return {
    currentDepartment,
    activeDepartment: pickMostRelevantDepartment(
      relatedDepartments,
      preferredFiscalYear ?? (await getLatestConfiguredFiscalYear())
    ) || currentDepartment,
    relatedDepartments
  };
};

const getAccessibleDepartmentIdsForUser = async (user, preferredFiscalYear) => {
  if (!user?.department_id) {
    return [];
  }

  if (user.role !== 'supervisor') {
    const { activeDepartment } = await resolveActiveDepartmentForDepartmentId(user.department_id, preferredFiscalYear);
    return activeDepartment?.id ? [activeDepartment.id] : [user.department_id];
  }

  const { relatedDepartments, activeDepartment } = await resolveActiveDepartmentForDepartmentId(user.department_id, preferredFiscalYear);
  if (relatedDepartments.length) {
    return relatedDepartments.map((department) => department.id);
  }

  return activeDepartment?.id ? [activeDepartment.id] : [user.department_id];
};

const syncUserDepartmentToActiveYear = async (userId, departmentId, preferredFiscalYear) => {
  const { activeDepartment } = await resolveActiveDepartmentForDepartmentId(departmentId, preferredFiscalYear);
  if (!activeDepartment) return null;

  if (activeDepartment.id !== departmentId) {
    await supabase
      .from('users')
      .update({
        department_id: activeDepartment.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);
  }

  return activeDepartment;
};

const ensureDepartmentsForFiscalYear = async (fiscalYear, options = {}) => {
  const { data: departments, error } = await supabase
    .from('departments')
    .select('id, name, fiscal_year, annual_budget, petty_cash_balance, used_budget, updated_at, created_at')
    .order('fiscal_year', { ascending: false })
    .order('updated_at', { ascending: false });

  if (error) throw error;

  const seedCanonicalName = toCanonicalDepartmentName(options.seedName || '');
  const departmentMap = new Map();

  (departments || []).forEach((department) => {
    const canonicalName = toCanonicalDepartmentName(department.name);
    const existing = departmentMap.get(canonicalName) || [];
    existing.push({
      ...department,
      name: canonicalName
    });
    departmentMap.set(canonicalName, existing);
  });

  const missingPayload = CANONICAL_DEPARTMENTS
    .filter((canonicalName) => !(departmentMap.get(canonicalName) || []).some((department) => Number(department.fiscal_year) === fiscalYear))
    .map((canonicalName) => {
      const latestDepartment = pickMostRelevantDepartment(departmentMap.get(canonicalName) || [], fiscalYear);
      const annualBudget =
        canonicalName === seedCanonicalName && typeof options.seedAnnualBudget === 'number'
          ? options.seedAnnualBudget
          : Number(latestDepartment?.annual_budget || 0);

      return {
        name: canonicalName,
        annual_budget: annualBudget,
        used_budget: 0,
        petty_cash_balance: 0,
        fiscal_year: fiscalYear,
        updated_at: new Date().toISOString()
      };
    });

  if (missingPayload.length) {
    const { error: insertError } = await supabase.from('departments').insert(missingPayload);
    if (insertError) throw insertError;
  }

  const { data: yearDepartments, error: yearDepartmentsError } = await supabase
    .from('departments')
    .select('*')
    .eq('fiscal_year', fiscalYear)
    .order('name', { ascending: true });

  if (yearDepartmentsError) throw yearDepartmentsError;
  return yearDepartments || [];
};

const canAccessRequest = (user, request) => {
  if (!user || !request) return false;
  if (user.role === 'employee') return request.employee_id === user.id;
  if (user.role === 'supervisor') return request.department_id === user.department_id;
  return true;
};

const getRequestForUser = async (requestId, user) => {
  const { data: request, error } = await supabase
    .from('expense_requests')
    .select('*')
    .eq('id', requestId)
    .single();

  if (error || !request) {
    return { error: error || { message: 'Request not found' }, status: 404 };
  }

  if (user?.role === 'supervisor') {
    const accessibleDepartmentIds = await getAccessibleDepartmentIdsForUser(user, await getLatestConfiguredFiscalYear());
    if (!accessibleDepartmentIds.includes(request.department_id)) {
      return { error: { message: 'Forbidden' }, status: 403 };
    }
  } else if (!canAccessRequest(user, request)) {
    return { error: { message: 'Forbidden' }, status: 403 };
  }

  return { request };
};
const getDepartmentGroupKey = (department) =>
  `${normalizeDepartmentName(department?.name || '').toLowerCase()}::${department?.fiscal_year ?? ''}`;
const isPendingBudgetStatus = (status) => status === 'pending_supervisor' || status === 'pending_accounting';
const buildDepartmentBudgetSummaryMap = async () => {
  const [departmentsResult, requestsResult, directExpensesResult] = await Promise.all([
    supabase
      .from('departments')
      .select('id, name, fiscal_year, annual_budget, used_budget, petty_cash_balance, updated_at, created_at'),
    supabase.from('expense_requests').select('department_id, amount, status'),
    supabase.from('direct_expenses').select('department_id, amount')
  ]);

  if (departmentsResult.error) throw departmentsResult.error;
  if (requestsResult.error) throw requestsResult.error;
  if (directExpensesResult.error) throw directExpensesResult.error;

  const departments = departmentsResult.data || [];
  const requests = requestsResult.data || [];
  const directExpenses = directExpensesResult.data || [];
  const groupedDepartmentIds = new Map();

  departments.forEach((department) => {
    const key = getDepartmentGroupKey(department);
    const existing = groupedDepartmentIds.get(key) || [];
    existing.push(department.id);
    groupedDepartmentIds.set(key, existing);
  });

  const summariesByGroup = new Map();
  groupedDepartmentIds.forEach((ids, key) => {
    const groupedDepartments = departments.filter((department) => ids.includes(department.id));
    const annualBudget = Math.max(...groupedDepartments.map((entry) => toNumber(entry.annual_budget)), 0);
    const pettyCashBalance = Math.max(...groupedDepartments.map((entry) => toNumber(entry.petty_cash_balance)), 0);
    const releasedRequestsTotal = requests
      .filter((request) => ids.includes(request.department_id) && isBudgetCommittedStatus(request.status))
      .reduce((sum, request) => sum + toNumber(request.amount), 0);
    const pendingSupervisorTotal = requests
      .filter((request) => ids.includes(request.department_id) && request.status === 'pending_supervisor')
      .reduce((sum, request) => sum + toNumber(request.amount), 0);
    const pendingAccountingTotal = requests
      .filter((request) => ids.includes(request.department_id) && request.status === 'pending_accounting')
      .reduce((sum, request) => sum + toNumber(request.amount), 0);
    const directExpensesTotal = directExpenses
      .filter((expense) => ids.includes(expense.department_id))
      .reduce((sum, expense) => sum + toNumber(expense.amount), 0);
    const usedBudget = releasedRequestsTotal + directExpensesTotal;
    const projectedCommittedTotal = usedBudget + pendingSupervisorTotal + pendingAccountingTotal;
    const currentDepartment = groupedDepartments.sort((left, right) => {
      const leftUpdatedAt = new Date(left.updated_at || left.created_at || 0).getTime();
      const rightUpdatedAt = new Date(right.updated_at || right.created_at || 0).getTime();
      return rightUpdatedAt - leftUpdatedAt;
    })[0];

    summariesByGroup.set(key, {
      department_name: currentDepartment?.name || 'Unknown department',
      fiscal_year: currentDepartment?.fiscal_year ?? null,
      annual_budget: annualBudget,
      used_budget: usedBudget,
      petty_cash_balance: pettyCashBalance,
      direct_expenses_total: directExpensesTotal,
      pending_supervisor_total: pendingSupervisorTotal,
      pending_accounting_total: pendingAccountingTotal,
      projected_committed_total: projectedCommittedTotal,
      remaining_budget: annualBudget - usedBudget,
      projected_remaining_budget: annualBudget - projectedCommittedTotal
    });
  });

  const summaryByDepartmentId = new Map();
  departments.forEach((department) => {
    summaryByDepartmentId.set(department.id, summariesByGroup.get(getDepartmentGroupKey(department)));
  });

  return summaryByDepartmentId;
};
const fetchRequestAllocationsByRequestIdV2 = async (requestIds) => {
  if (!requestIds.length) return new Map();

  const { data, error } = await supabase
    .from('request_allocations')
    .select('id, request_id, department_id, amount, departments(name, fiscal_year)')
    .in('request_id', requestIds);

  if (error) throw error;

  const allocationMap = new Map();
  (data || []).forEach((allocation) => {
    const existing = allocationMap.get(allocation.request_id) || [];
    existing.push(allocation);
    allocationMap.set(allocation.request_id, existing);
  });

  return allocationMap;
};
const normalizeAllocationsV2 = (request, allocations) => {
  const source = allocations?.length
    ? allocations
    : [{ department_id: request.department_id, amount: request.amount }];
  const merged = new Map();
  source.forEach((allocation) => {
    const departmentId = String(allocation.department_id || '').trim();
    const amount = toNumber(allocation.amount);
    if (!departmentId || amount <= 0) return;
    merged.set(departmentId, (merged.get(departmentId) || 0) + amount);
  });
  return Array.from(merged.entries()).map(([department_id, amount]) => ({ department_id, amount }));
};
const allocationTotalsMatchRequestV2 = (requestAmount, allocations) =>
  allocations.reduce((sum, allocation) => sum + toNumber(allocation.amount), 0).toFixed(2) === toNumber(requestAmount).toFixed(2);
const buildDepartmentBudgetSummaryMapV2 = async () => {
  const [departmentsResult, requestsResult, directExpensesResult] = await Promise.all([
    supabase
      .from('departments')
      .select('id, name, fiscal_year, annual_budget, used_budget, petty_cash_balance, updated_at, created_at'),
    supabase.from('expense_requests').select('id, department_id, amount, status'),
    supabase.from('direct_expenses').select('department_id, amount')
  ]);

  if (departmentsResult.error) throw departmentsResult.error;
  if (requestsResult.error) throw requestsResult.error;
  if (directExpensesResult.error) throw directExpensesResult.error;

  const departments = departmentsResult.data || [];
  const requests = requestsResult.data || [];
  const directExpenses = directExpensesResult.data || [];
  const allocationsByRequestId = await fetchRequestAllocationsByRequestIdV2(requests.map((request) => request.id));
  const groupedDepartmentIds = new Map();

  departments.forEach((department) => {
    const key = getDepartmentGroupKey(department);
    const existing = groupedDepartmentIds.get(key) || [];
    existing.push(department.id);
    groupedDepartmentIds.set(key, existing);
  });

  const totalsByDepartmentId = new Map();
  requests.forEach((request) => {
    const impacts = request.status === 'pending_supervisor'
      ? [{ department_id: request.department_id, amount: toNumber(request.amount) }]
      : normalizeAllocationsV2(request, allocationsByRequestId.get(request.id) || []);

    impacts.forEach((impact) => {
      const current = totalsByDepartmentId.get(impact.department_id) || { released: 0, pendingSupervisor: 0, pendingAccounting: 0 };
      if (request.status === 'pending_supervisor') current.pendingSupervisor += impact.amount;
      else if (request.status === 'pending_accounting') current.pendingAccounting += impact.amount;
      else if (isBudgetCommittedStatus(request.status)) current.released += impact.amount;
      totalsByDepartmentId.set(impact.department_id, current);
    });
  });

  const summaryByDepartmentId = new Map();
  groupedDepartmentIds.forEach((ids, key) => {
    const groupedDepartments = departments.filter((department) => ids.includes(department.id));
    const annualBudget = Math.max(...groupedDepartments.map((entry) => toNumber(entry.annual_budget)), 0);
    const pettyCashBalance = Math.max(...groupedDepartments.map((entry) => toNumber(entry.petty_cash_balance)), 0);
    const directExpensesTotal = directExpenses
      .filter((expense) => ids.includes(expense.department_id))
      .reduce((sum, expense) => sum + toNumber(expense.amount), 0);
    const releasedRequestsTotal = ids.reduce((sum, id) => sum + (totalsByDepartmentId.get(id)?.released || 0), 0);
    const pendingSupervisorTotal = ids.reduce((sum, id) => sum + (totalsByDepartmentId.get(id)?.pendingSupervisor || 0), 0);
    const pendingAccountingTotal = ids.reduce((sum, id) => sum + (totalsByDepartmentId.get(id)?.pendingAccounting || 0), 0);
    const usedBudget = releasedRequestsTotal + directExpensesTotal;
    const projectedCommittedTotal = usedBudget + pendingSupervisorTotal + pendingAccountingTotal;
    const currentDepartment = groupedDepartments.sort((left, right) => {
      const leftUpdatedAt = new Date(left.updated_at || left.created_at || 0).getTime();
      const rightUpdatedAt = new Date(right.updated_at || right.created_at || 0).getTime();
      return rightUpdatedAt - leftUpdatedAt;
    })[0];

    const summary = {
      department_name: currentDepartment?.name || 'Unknown department',
      fiscal_year: currentDepartment?.fiscal_year ?? null,
      annual_budget: annualBudget,
      used_budget: usedBudget,
      petty_cash_balance: pettyCashBalance,
      direct_expenses_total: directExpensesTotal,
      pending_supervisor_total: pendingSupervisorTotal,
      pending_accounting_total: pendingAccountingTotal,
      projected_committed_total: projectedCommittedTotal,
      remaining_budget: annualBudget - usedBudget,
      projected_remaining_budget: annualBudget - projectedCommittedTotal
    };

    groupedDepartments.forEach((department) => {
      summaryByDepartmentId.set(department.id, summary);
    });
  });

  return { summaryByDepartmentId, allocationsByRequestId };
};
const enrichRequestsV2 = (rows, budgetSummaryMap, allocationsByRequestId) =>
  rows.map((row) => {
    const amount = toNumber(row.amount);
    const requestFallbackSummary = budgetSummaryMap.get(row.department_id) || null;
    const sourceAllocations = allocationsByRequestId.get(row.id) || [];
    const fallbackAllocation = sourceAllocations.length
      ? sourceAllocations
      : [{ request_id: row.id, department_id: row.department_id, amount }];

    const allocations = fallbackAllocation.map((allocation) => {
      const departmentSummary = budgetSummaryMap.get(allocation.department_id) || requestFallbackSummary;
      const allocationAmount = toNumber(allocation.amount);
      return {
        ...allocation,
        amount: allocationAmount,
        department_name: departmentSummary?.department_name || 'Unknown department',
        annual_budget: departmentSummary?.annual_budget ?? 0,
        used_budget: departmentSummary?.used_budget ?? 0,
        remaining_budget: departmentSummary?.remaining_budget ?? 0,
        projected_remaining_budget: departmentSummary?.projected_remaining_budget ?? 0,
        projected_remaining_after_approval: departmentSummary ? departmentSummary.remaining_budget - allocationAmount : 0
      };
    });

    const totalProjectedAfterApproval = allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
    return {
      ...row,
      requester_name: row.users?.name || 'Unknown requester',
      department_name: requestFallbackSummary?.department_name || row.departments?.name || 'Unknown department',
      allocations,
      budget_summary: requestFallbackSummary
        ? {
            ...requestFallbackSummary,
            request_amount: amount,
            projected_used_after_approval: requestFallbackSummary.used_budget + totalProjectedAfterApproval,
            projected_remaining_after_approval: requestFallbackSummary.remaining_budget - totalProjectedAfterApproval
          }
        : null
    };
  });

// Auth routes
app.post('/api/auth/login', async (req, res) => {
  try {
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

    const token = jwt.sign(
      { id: user.id, role: user.role, department_id: user.department_id },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  try {
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
      return res.json({ message: getPasswordResetSentMessage() });
    }
    const { data: activeResetToken, error: activeResetTokenError } = await getActiveResetTokenForUser(user.id);

    if (activeResetTokenError) {
      return res.status(400).json({ error: activeResetTokenError.message || 'Unable to process password reset.' });
    }

    if (activeResetToken) {
      if (wasPasswordResetLinkSentRecently(activeResetToken.last_sent_at)) {
        return res.json({ message: getPasswordResetCooldownMessage() });
      }

      const rawToken = buildPasswordResetToken(activeResetToken);
      const resetUrl = `${getAppUrl(req.headers.origin)}/reset-password?token=${rawToken}`;
      const emailContent = buildResetPasswordEmail(user.name || 'there', resetUrl);

      await sendEmail(
        user.email,
        'Reset your Madison88 password',
        emailContent.text,
        emailContent.html
      );

      await supabase
        .from('password_reset_tokens')
        .update({ last_sent_at: new Date().toISOString() })
        .eq('id', activeResetToken.id);

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
        expires_at: expiresAt,
        last_sent_at: new Date().toISOString()
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

    await sendEmail(
      user.email,
      'Reset your Madison88 password',
      emailContent.text,
      emailContent.html
    );

    return res.json({ message: getPasswordResetSentMessage() });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    const password = String(req.body?.password || '');

    if (!token || !password) {
      return res.status(400).json({ error: 'Reset token and new password are required.' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }

    const tokenHash = getPasswordResetTokenHash(token);
    let decodedToken;

    try {
      decodedToken = jwt.verify(token, getPasswordResetSecret());
    } catch (error) {
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
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

app.get('/api/auth/signup-departments', async (_req, res) => {
  try {
    const { data, error } = await getSignupDepartments();
    if (error) return res.status(400).json({ error: error.message || error });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/auth/profile', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'employee' && req.user.role !== 'supervisor') {
      return res.status(403).json({ error: 'Only employees and supervisors can update their own department.' });
    }

    const { name, department_id } = req.body;
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
      return res.status(400).json({ error: error?.message || 'Failed to update profile' });
    }

    await Promise.all([
      supabase
        .from('expense_requests')
        .update({
          department_id: department.id,
          fiscal_year: department.fiscal_year,
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
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.json({
      token,
      user: updatedUser
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password, department_id } = req.body;
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

    if (existingUserError) return res.status(400).json({ error: existingUserError.message || existingUserError });
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

    if (insertError || !newUser) {
      return res.status(400).json({ error: insertError?.message || 'Failed to create account' });
    }

    const token = jwt.sign(
      { id: newUser.id, role: newUser.role, department_id: newUser.department_id },
      JWT_SECRET,
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
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/auth/me', authenticate, async (req, res) => {
  try {
    const { data: userData, error } = await supabase
      .from('users')
      .select('id, name, email, role, department_id')
      .eq('id', req.user.id)
      .single();

    if (error) return res.status(400).json({ error });
    const activeDepartment = await syncUserDepartmentToActiveYear(
      req.user.id,
      userData.department_id,
      await getLatestConfiguredFiscalYear()
    );
    res.json({
      ...userData,
      department_id: activeDepartment?.id || userData.department_id,
      fiscal_year: activeDepartment?.fiscal_year ?? null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/notifications', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) return res.status(400).json({ error });
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/notifications/:id/read', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .single();

    if (error) return res.status(400).json({ error });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/auth/users', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const [{ data: users, error: usersError }, { data: departments, error: departmentsError }] = await Promise.all([
      supabase.from('users').select('id, name, email, role, department_id, created_at, updated_at').order('updated_at', { ascending: false }),
      supabase.from('departments').select('id, name, fiscal_year').order('name', { ascending: true })
    ]);

    if (usersError) return res.status(400).json({ error: usersError });
    if (departmentsError) return res.status(400).json({ error: departmentsError });

    const departmentMap = new Map((departments || []).map((department) => [department.id, department]));
    res.json((users || []).map((user) => ({
      ...user,
      department_name: departmentMap.get(user.department_id)?.name || '',
      fiscal_year: departmentMap.get(user.department_id)?.fiscal_year || null
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/auth/users/:id', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const normalizedName = String(req.body?.name || '').trim();
    const normalizedRole = String(req.body?.role || '').trim();
    const normalizedDepartmentId = String(req.body?.department_id || '').trim();

    if (!normalizedName || !normalizedRole) {
      return res.status(400).json({ error: 'Name and role are required.' });
    }

    if (!['employee', 'supervisor', 'accounting', 'admin', 'super_admin'].includes(normalizedRole)) {
      return res.status(400).json({ error: 'Invalid role.' });
    }

    const payload = {
      name: normalizedName,
      role: normalizedRole,
      department_id: normalizedRole === 'super_admin' ? null : (normalizedDepartmentId || null),
      updated_at: new Date().toISOString()
    };

    if (normalizedRole !== 'super_admin' && !payload.department_id) {
      return res.status(400).json({ error: 'Department is required for this role.' });
    }

    const { data, error } = await supabase
      .from('users')
      .update(payload)
      .eq('id', req.params.id)
      .select('id, name, email, role, department_id, updated_at')
      .single();

    if (error) return res.status(400).json({ error: error.message || error });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/auth/users/:id', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own super admin account.' });
    }

    const { data: targetUser, error: fetchError } = await supabase
      .from('users')
      .select('id, role')
      .eq('id', req.params.id)
      .maybeSingle();

    if (fetchError) return res.status(400).json({ error: fetchError.message || fetchError });
    if (!targetUser) return res.status(404).json({ error: 'User not found.' });

    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', req.params.id);

    if (error) return res.status(400).json({ error: error.message || error });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/system/health', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const start = Date.now();
    const [{ count: userCount }, { count: deptCount }, { error: dbError }] = await Promise.all([
      supabase.from('users').select('*', { count: 'exact', head: true }),
      supabase.from('departments').select('*', { count: 'exact', head: true }),
      supabase.from('users').select('id').limit(1)
    ]);

    res.json({
      backend: {
        status: 'healthy',
        uptime: process.uptime(),
        latency_ms: Date.now() - start
      },
      supabase: {
        status: dbError ? 'error' : 'healthy',
        error: dbError ? dbError.message : null
      },
      counts: {
        users: userCount || 0,
        departments: deptCount || 0
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Requests routes
app.get('/api/requests', authenticate, async (req, res) => {
  try {
    const activeFiscalYear = await getLatestConfiguredFiscalYear();
    let query = supabase.from('expense_requests').select(REQUEST_RELATIONS_SELECT);
    if (req.user.role === 'employee') {
      query = query.eq('employee_id', req.user.id);
    } else if (req.user.role === 'supervisor') {
      const accessibleDepartmentIds = await getAccessibleDepartmentIdsForUser(req.user, activeFiscalYear);
      query = accessibleDepartmentIds.length
        ? query.in('department_id', accessibleDepartmentIds)
        : query.eq('department_id', req.user.department_id);
    }

    const { data, error } = await query;
    if (error) return res.status(400).json({ error });
    const { summaryByDepartmentId, allocationsByRequestId } = await buildDepartmentBudgetSummaryMapV2();
    res.json(enrichRequestsV2(data || [], summaryByDepartmentId, allocationsByRequestId));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/requests', authenticate, authorize(['employee']), async (req, res) => {
  try {
    const { item_name, category, amount, purpose, priority } = req.body;
    const normalizedAmount = toNumber(amount);
    const activeFiscalYear = await getLatestConfiguredFiscalYear();
    const activeDepartment = await syncUserDepartmentToActiveYear(req.user.id, req.user.department_id, activeFiscalYear);

    if (!item_name || !category || !purpose) {
      return res.status(400).json({ error: 'Item name, category, and purpose are required' });
    }

    if (normalizedAmount <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than zero' });
    }

    if (!activeDepartment) {
      return res.status(400).json({ error: 'Your department is not configured for the active fiscal year yet.' });
    }

    const request_code = `REQ-${Date.now()}`;

    const { data, error } = await supabase
      .from('expense_requests')
      .insert({
        request_code,
        employee_id: req.user.id,
        department_id: activeDepartment.id,
        fiscal_year: activeDepartment.fiscal_year,
        item_name,
        category,
        amount: normalizedAmount,
        purpose,
        priority,
        status: 'pending_supervisor',
        submitted_at: new Date()
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error });

    await supabase.from('approval_logs').insert({
      request_id: data.id,
      actor_id: req.user.id,
      action: 'submitted',
      stage: 'supervisor',
      note: 'Request submitted'
    });

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/requests/audit-logs', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const [approvalLogsResult, allocationLogsResult] = await Promise.all([
      supabase.from('approval_logs').select('*').order('timestamp', { ascending: false }).limit(150),
      supabase.from('allocation_logs').select('*').order('created_at', { ascending: false }).limit(150)
    ]);

    if (approvalLogsResult.error) return res.status(400).json({ error: approvalLogsResult.error });
    if (allocationLogsResult.error) return res.status(400).json({ error: allocationLogsResult.error });

    const approvalLogs = (approvalLogsResult.data || []).map((log) => ({ ...log, log_type: 'approval', event_time: log.timestamp }));
    const allocationLogs = (allocationLogsResult.data || []).map((log) => ({ ...log, log_type: 'allocation', event_time: log.created_at }));
    const combinedLogs = [...approvalLogs, ...allocationLogs]
      .sort((left, right) => new Date(right.event_time).getTime() - new Date(left.event_time).getTime())
      .slice(0, 200);

    const actorIds = Array.from(new Set(combinedLogs.map((log) => log.actor_id).filter(Boolean)));
    const requestIds = Array.from(new Set(combinedLogs.map((log) => log.request_id).filter(Boolean)));

    const { data: actors } = actorIds.length
      ? await supabase.from('users').select('id, name, role').in('id', actorIds)
      : { data: [] };
    const { data: requests } = requestIds.length
      ? await supabase.from('expense_requests').select('id, request_code, item_name, status').in('id', requestIds)
      : { data: [] };

    const actorMap = new Map((actors || []).map((actor) => [actor.id, actor]));
    const requestMap = new Map((requests || []).map((request) => [request.id, request]));

    res.json(combinedLogs.map((log) => ({
      ...log,
      actor_name: actorMap.get(log.actor_id)?.name || 'System',
      actor_role: actorMap.get(log.actor_id)?.role || '',
      request_code: requestMap.get(log.request_id)?.request_code || '',
      item_name: requestMap.get(log.request_id)?.item_name || '',
      request_status: requestMap.get(log.request_id)?.status || ''
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/requests/:id', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('expense_requests')
      .select(REQUEST_RELATIONS_SELECT)
      .eq('id', req.params.id)
      .single();
    if (error) return res.status(400).json({ error });
    if (req.user.role === 'employee' && data.employee_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    if (req.user.role === 'supervisor') {
      const accessibleDepartmentIds = await getAccessibleDepartmentIdsForUser(req.user, await getLatestConfiguredFiscalYear());
      if (!accessibleDepartmentIds.includes(data.department_id)) return res.status(403).json({ error: 'Forbidden' });
    }

    const { summaryByDepartmentId, allocationsByRequestId } = await buildDepartmentBudgetSummaryMapV2();
    res.json(enrichRequestsV2([data], summaryByDepartmentId, allocationsByRequestId)[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Departments routes
app.get('/api/departments', authenticate, async (req, res) => {
  try {
    const { data: departments, error } = await supabase.from('departments').select('*');
    if (error) return res.status(400).json({ error });
    const { summaryByDepartmentId } = await buildDepartmentBudgetSummaryMapV2();
    res.json(
      (departments || []).map((department) => {
        const summary = summaryByDepartmentId.get(department.id);
        return {
          ...department,
          used_budget: summary?.used_budget ?? toNumber(department.used_budget),
          pending_supervisor_total: summary?.pending_supervisor_total ?? 0,
          pending_accounting_total: summary?.pending_accounting_total ?? 0,
          projected_committed_total: summary?.projected_committed_total ?? toNumber(department.used_budget),
          projected_remaining_budget: summary?.projected_remaining_budget ?? toNumber(department.annual_budget) - toNumber(department.used_budget),
          remaining_budget: summary?.remaining_budget ?? toNumber(department.annual_budget) - toNumber(department.used_budget)
        };
      })
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/departments', authenticate, authorize(['accounting', 'admin']), async (req, res) => {
  try {
    const { name, annual_budget, fiscal_year } = req.body;

    if (!name || !fiscal_year) {
      return res.status(400).json({ error: 'Department name and fiscal year are required' });
    }

    const normalizedName = String(name).trim();
    const normalizedFiscalYear = Number.parseInt(fiscal_year, 10);
    const canonicalDepartmentName = toCanonicalDepartmentName(normalizedName);

    if (!canonicalDepartmentName) {
      return res.status(400).json({ error: 'Department name is required' });
    }

    const { data: existingDepartment, error: existingDepartmentError } = await supabase
      .from('departments')
      .select('id, name, fiscal_year')
      .ilike('name', canonicalDepartmentName)
      .eq('fiscal_year', normalizedFiscalYear)
      .maybeSingle();

    if (existingDepartmentError) return res.status(400).json({ error: existingDepartmentError });
    if (existingDepartment) {
      return res.status(409).json({ error: 'A department with this name and fiscal year already exists.' });
    }

    const yearDepartments = await ensureDepartmentsForFiscalYear(normalizedFiscalYear, {
      seedName: canonicalDepartmentName,
      seedAnnualBudget: toNumber(annual_budget)
    });
    const createdDepartment = yearDepartments.find((department) => String(department.name).trim().toLowerCase() === canonicalDepartmentName.toLowerCase());

    if (!createdDepartment) {
      return res.status(400).json({ error: 'Unable to provision the fiscal year departments.' });
    }

    res.status(201).json({
      ...createdDepartment,
      generated_departments: yearDepartments
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/departments/:id/budget-breakdown', authenticate, async (req, res) => {
  try {
    const departmentId = req.params.id;
    const departmentResult = await supabase
      .from('departments')
      .select('id, name, fiscal_year, annual_budget, used_budget, petty_cash_balance, updated_at, created_at')
      .eq('id', departmentId)
      .single();

    if (departmentResult.error) return res.status(400).json({ error: departmentResult.error });
    const selectedDepartment = departmentResult.data;
    const duplicateDepartmentsResult = await supabase
      .from('departments')
      .select('id, name, fiscal_year, annual_budget, used_budget, petty_cash_balance, updated_at, created_at')
      .ilike('name', normalizeDepartmentName(selectedDepartment.name))
      .eq('fiscal_year', selectedDepartment.fiscal_year)
      .order('updated_at', { ascending: false });

    if (duplicateDepartmentsResult.error) return res.status(400).json({ error: duplicateDepartmentsResult.error });

    const relatedDepartments = duplicateDepartmentsResult.data || [selectedDepartment];
    const relatedDepartmentIds = relatedDepartments.map((department) => department.id);
    const department = relatedDepartments.reduce((current, candidate) => {
      if (toNumber(candidate.used_budget) !== toNumber(current.used_budget)) {
        return toNumber(candidate.used_budget) > toNumber(current.used_budget) ? candidate : current;
      }

      const currentUpdatedAt = new Date(current.updated_at || current.created_at || 0).getTime();
      const candidateUpdatedAt = new Date(candidate.updated_at || candidate.created_at || 0).getTime();
      return candidateUpdatedAt > currentUpdatedAt ? candidate : current;
    }, selectedDepartment);

    const [requestsResult, directExpensesResult, pettyCashResult] = await Promise.all([
      supabase
        .from('expense_requests')
        .select('id, request_code, department_id, item_name, category, amount, priority, status, submitted_at, updated_at')
        .order('submitted_at', { ascending: false }),
      supabase
        .from('direct_expenses')
        .select('id, item_name, category, amount, description, expense_date, created_at')
        .in('department_id', relatedDepartmentIds)
        .order('expense_date', { ascending: false }),
      supabase
        .from('petty_cash_transactions')
        .select('id, type, amount, purpose, reference_request_id, transaction_date, created_at')
        .in('department_id', relatedDepartmentIds)
        .order('transaction_date', { ascending: false })
    ]);

    if (requestsResult.error) return res.status(400).json({ error: requestsResult.error });
    if (directExpensesResult.error) return res.status(400).json({ error: directExpensesResult.error });
    if (pettyCashResult.error) return res.status(400).json({ error: pettyCashResult.error });

    const allRequests = requestsResult.data || [];
    const allocationsByRequestId = await fetchRequestAllocationsByRequestIdV2(allRequests.map((request) => request.id));
    const requests = allRequests.filter((request) => {
      const allocations = normalizeAllocationsV2(request, allocationsByRequestId.get(request.id) || []);
      return allocations.some((allocation) => relatedDepartmentIds.includes(allocation.department_id));
    });
    const requestsWithDepartmentShare = requests.map((request) => {
      const allocations = normalizeAllocationsV2(request, allocationsByRequestId.get(request.id) || []);
      const departmentAllocationAmount = allocations
        .filter((allocation) => relatedDepartmentIds.includes(allocation.department_id))
        .reduce((sum, allocation) => sum + toNumber(allocation.amount), 0);

      return {
        ...request,
        department_allocation_amount: departmentAllocationAmount,
        allocation_count: allocations.length
      };
    });
    const directExpenses = directExpensesResult.data || [];
    const pettyCashTransactions = pettyCashResult.data || [];

    const totals = {
      annual_budget: Math.max(...relatedDepartments.map((entry) => toNumber(entry.annual_budget)), 0),
      used_budget: requests
        .filter((request) => isBudgetCommittedStatus(request.status))
        .reduce((sum, request) => {
          const allocations = normalizeAllocationsV2(request, allocationsByRequestId.get(request.id) || []);
          return sum + allocations
            .filter((allocation) => relatedDepartmentIds.includes(allocation.department_id))
            .reduce((allocationSum, allocation) => allocationSum + toNumber(allocation.amount), 0);
        }, 0) +
        directExpenses.reduce((sum, expense) => sum + toNumber(expense.amount), 0),
      petty_cash_balance: Math.max(...relatedDepartments.map((entry) => toNumber(entry.petty_cash_balance)), 0),
      released_requests_total: requests
        .filter((request) => isBudgetCommittedStatus(request.status))
        .reduce((sum, request) => {
          const allocations = normalizeAllocationsV2(request, allocationsByRequestId.get(request.id) || []);
          return sum + allocations
            .filter((allocation) => relatedDepartmentIds.includes(allocation.department_id))
            .reduce((allocationSum, allocation) => allocationSum + toNumber(allocation.amount), 0);
        }, 0),
      pending_supervisor_total: requests
        .filter((request) => request.status === 'pending_supervisor')
        .reduce((sum, request) => {
          const allocations = normalizeAllocationsV2(request, allocationsByRequestId.get(request.id) || []);
          return sum + allocations
            .filter((allocation) => relatedDepartmentIds.includes(allocation.department_id))
            .reduce((allocationSum, allocation) => allocationSum + toNumber(allocation.amount), 0);
        }, 0),
      pending_accounting_total: requests
        .filter((request) => request.status === 'pending_accounting')
        .reduce((sum, request) => {
          const allocations = normalizeAllocationsV2(request, allocationsByRequestId.get(request.id) || []);
          return sum + allocations
            .filter((allocation) => relatedDepartmentIds.includes(allocation.department_id))
            .reduce((allocationSum, allocation) => allocationSum + toNumber(allocation.amount), 0);
        }, 0),
      rejected_total: requests
        .filter((request) => request.status === 'rejected')
        .reduce((sum, request) => sum + toNumber(request.amount), 0),
      direct_expenses_total: directExpenses
        .reduce((sum, expense) => sum + toNumber(expense.amount), 0),
      petty_cash_disbursed_total: pettyCashTransactions
        .filter((transaction) => transaction.type === 'disbursement')
        .reduce((sum, transaction) => sum + toNumber(transaction.amount), 0),
      petty_cash_replenished_total: pettyCashTransactions
        .filter((transaction) => transaction.type === 'replenishment')
        .reduce((sum, transaction) => sum + toNumber(transaction.amount), 0)
    };

    const breakdownTotal = totals.released_requests_total + totals.direct_expenses_total;
    const remainingBudget = totals.annual_budget - totals.used_budget;
    const committedBudget = totals.used_budget + totals.pending_supervisor_total + totals.pending_accounting_total;

    res.json({
      department: {
        ...department,
        annual_budget: totals.annual_budget,
        used_budget: totals.used_budget,
        petty_cash_balance: totals.petty_cash_balance,
        remaining_budget: remainingBudget,
        utilization_percentage: totals.annual_budget > 0 ? (totals.used_budget / totals.annual_budget) * 100 : 0,
        projected_committed_total: committedBudget,
        projected_remaining_budget: totals.annual_budget - committedBudget,
        breakdown_variance: totals.used_budget - breakdownTotal
      },
      totals,
      counts: {
        total_requests: requestsWithDepartmentShare.length,
        released_requests: requestsWithDepartmentShare.filter((request) => isBudgetCommittedStatus(request.status)).length,
        pending_supervisor: requestsWithDepartmentShare.filter((request) => request.status === 'pending_supervisor').length,
        pending_accounting: requestsWithDepartmentShare.filter((request) => request.status === 'pending_accounting').length,
        rejected_requests: requestsWithDepartmentShare.filter((request) => request.status === 'rejected').length,
        direct_expenses: directExpenses.length,
        petty_cash_transactions: pettyCashTransactions.length
      },
      recent_requests: requestsWithDepartmentShare.slice(0, 8),
      recent_direct_expenses: directExpenses.slice(0, 8),
      recent_petty_cash_transactions: pettyCashTransactions.slice(0, 8),
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/departments/:id/budget', authenticate, authorize(['accounting', 'admin']), async (req, res) => {
  try {
    const { annual_budget } = req.body;
    const { data, error } = await supabase
      .from('departments')
      .update({ annual_budget, updated_at: new Date() })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) return res.status(400).json({ error });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/petty-cash/:dept_id', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'accounting' && req.user.role !== 'admin' && req.user.department_id !== req.params.dept_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { data, error } = await supabase
      .from('petty_cash_transactions')
      .select('*')
      .eq('department_id', req.params.dept_id)
      .order('transaction_date', { ascending: false });

    if (error) return res.status(400).json({ error });
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/petty-cash/disburse', authenticate, authorize(['accounting', 'admin']), async (req, res) => {
  try {
    const { department_id, amount, purpose, reference_request_id } = req.body;
    const normalizedPurpose = String(purpose || '').trim();
    const normalizedAmount = toNumber(amount);

    if (!department_id) return res.status(400).json({ error: 'Department is required' });
    if (!normalizedPurpose) return res.status(400).json({ error: 'Reason is required when deducting petty cash' });
    if (normalizedAmount <= 0) return res.status(400).json({ error: 'Amount must be greater than zero' });

    const { data: dept, error: departmentError } = await supabase.from('departments').select('*').eq('id', department_id).single();
    if (departmentError) return res.status(400).json({ error: departmentError });
    if (!dept) return res.status(404).json({ error: 'Department not found' });
    if (toNumber(dept.petty_cash_balance) < normalizedAmount) {
      return res.status(400).json({ error: 'Insufficient petty cash' });
    }

    const { data, error } = await supabase
      .from('petty_cash_transactions')
      .insert({
        department_id,
        managed_by: req.user.id,
        type: 'disbursement',
        amount: normalizedAmount,
        purpose: normalizedPurpose,
        reference_request_id,
        transaction_date: new Date()
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error });

    await supabase
      .from('departments')
      .update({ petty_cash_balance: toNumber(dept.petty_cash_balance) - normalizedAmount, updated_at: new Date() })
      .eq('id', dept.id);

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/petty-cash/replenish', authenticate, authorize(['accounting', 'admin']), async (req, res) => {
  try {
    const { department_id, amount, purpose } = req.body;
    const normalizedPurpose = String(purpose || '').trim();
    const normalizedAmount = toNumber(amount);

    if (!department_id) return res.status(400).json({ error: 'Department is required' });
    if (!normalizedPurpose) return res.status(400).json({ error: 'Reason is required when replenishing petty cash' });
    if (normalizedAmount <= 0) return res.status(400).json({ error: 'Amount must be greater than zero' });

    const { data, error } = await supabase
      .from('petty_cash_transactions')
      .insert({
        department_id,
        managed_by: req.user.id,
        type: 'replenishment',
        amount: normalizedAmount,
        purpose: normalizedPurpose,
        transaction_date: new Date()
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error });

    const { data: dept, error: departmentError } = await supabase.from('departments').select('*').eq('id', department_id).single();
    if (departmentError) return res.status(400).json({ error: departmentError });
    if (!dept) return res.status(404).json({ error: 'Department not found' });

    await supabase
      .from('departments')
      .update({ petty_cash_balance: toNumber(dept.petty_cash_balance) + normalizedAmount, updated_at: new Date() })
      .eq('id', dept.id);

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Approvals routes
app.patch('/api/requests/:id/priority', authenticate, authorize(['supervisor', 'admin']), async (req, res) => {
  try {
    const normalizedPriority = String(req.body?.priority || '').trim().toLowerCase();
    if (!['low', 'normal', 'urgent'].includes(normalizedPriority)) {
      return res.status(400).json({ error: 'Priority must be low, normal, or urgent.' });
    }

    const result = await getRequestForUser(req.params.id, req.user);
    if (result.error) {
      return res.status(result.status).json({ error: result.error.message || result.error });
    }

    const request = result.request;
    if (req.user.role === 'supervisor' && request.status !== 'pending_supervisor') {
      return res.status(400).json({ error: 'Urgency can only be updated while waiting for supervisor approval.' });
    }

    const { data, error } = await supabase
      .from('expense_requests')
      .update({
        priority: normalizedPriority,
        updated_at: new Date()
      })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message || error });

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/requests/:id/approve', authenticate, authorize(['supervisor', 'accounting']), async (req, res) => {
  try {
    const result = await getRequestForUser(req.params.id, req.user);
    if (result.error) {
      return res.status(result.status).json({ error: result.error.message || result.error });
    }

    const request = result.request;
    let newStatus = '';
    let stage = '';

    if (req.user.role === 'supervisor') {
      if (request.status !== 'pending_supervisor') {
        return res.status(400).json({ error: 'Only requests waiting for supervisor approval can be approved here' });
      }

      newStatus = 'pending_accounting';
      stage = 'accounting';
      } else if (req.user.role === 'accounting') {
        if (request.status !== 'pending_accounting') {
          return res.status(400).json({ error: 'Only requests waiting for accounting approval can be released here' });
        }
        const allocationsByRequestId = await fetchRequestAllocationsByRequestIdV2([request.id]);
        const normalizedAllocations = normalizeAllocationsV2(request, allocationsByRequestId.get(request.id) || []);
        if (!allocationTotalsMatchRequestV2(request.amount, normalizedAllocations)) {
          return res.status(400).json({ error: 'Finalize the department allocations before release. The allocated total must match the request amount.' });
        }
        const { summaryByDepartmentId } = await buildDepartmentBudgetSummaryMapV2();
        const insufficientDepartment = normalizedAllocations.find((allocation) => {
          const summary = summaryByDepartmentId.get(allocation.department_id);
          return !summary || summary.projected_remaining_budget < 0;
        });
        if (insufficientDepartment) {
          const summary = summaryByDepartmentId.get(insufficientDepartment.department_id);
          return res.status(400).json({ error: `Insufficient projected budget for ${summary?.department_name || 'the selected department'}.` });
        }

        newStatus = 'released';
        stage = 'finance';

        for (const allocation of normalizedAllocations) {
          const { data: department, error: departmentError } = await supabase.from('departments').select('id, used_budget').eq('id', allocation.department_id).single();
          if (departmentError || !department) {
            return res.status(400).json({ error: departmentError?.message || 'Department not found.' });
          }
          const { error: updateDepartmentError } = await supabase
            .from('departments')
            .update({ used_budget: toNumber(department.used_budget) + toNumber(allocation.amount), updated_at: new Date() })
            .eq('id', allocation.department_id);
          if (updateDepartmentError) return res.status(400).json({ error: updateDepartmentError });
        }

        await supabase.from('allocation_logs').insert({
          request_id: request.id,
          actor_id: req.user.id,
          action: 'released',
          note: `Released with ${normalizedAllocations.length} department allocation(s).`
        });
      }

    const { data, error } = await supabase
      .from('expense_requests')
      .update({ status: newStatus, updated_at: new Date() })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) return res.status(400).json({ error });

    await supabase.from('approval_logs').insert({
      request_id: request.id,
      actor_id: req.user.id,
      action: 'approved',
      stage,
      note: req.body?.note || ''
    });

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/requests/:id/allocations', authenticate, authorize(['accounting', 'admin']), async (req, res) => {
  try {
    const { data: request, error: requestError } = await supabase
      .from('expense_requests')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (requestError || !request) return res.status(404).json({ error: requestError?.message || 'Request not found.' });
    if (request.status !== 'pending_accounting') {
      return res.status(400).json({ error: 'Allocations can only be updated while waiting for accounting approval.' });
    }

    const normalizedAllocations = normalizeAllocationsV2(request, req.body?.allocations || []);
    if (!normalizedAllocations.length) {
      return res.status(400).json({ error: 'Add at least one department allocation.' });
    }
    if (!allocationTotalsMatchRequestV2(request.amount, normalizedAllocations)) {
      return res.status(400).json({ error: 'The total of all department allocations must exactly match the request amount.' });
    }

    const departmentIds = normalizedAllocations.map((allocation) => allocation.department_id);
    const { data: validDepartments, error: departmentError } = await supabase
      .from('departments')
      .select('id')
      .in('id', departmentIds);
    if (departmentError) return res.status(400).json({ error: departmentError });
    if ((validDepartments || []).length !== departmentIds.length) {
      return res.status(400).json({ error: 'One or more selected departments could not be found.' });
    }

    const { data: existingAllocations, error: existingAllocationsError } = await supabase
      .from('request_allocations')
      .select('id, department_id, amount')
      .eq('request_id', req.params.id);
    if (existingAllocationsError) return res.status(400).json({ error: existingAllocationsError });

    const { error: deleteError } = await supabase.from('request_allocations').delete().eq('request_id', req.params.id);
    if (deleteError) return res.status(400).json({ error: deleteError });

    const { data: savedAllocations, error: insertError } = await supabase
      .from('request_allocations')
      .insert(normalizedAllocations.map((allocation) => ({
        request_id: req.params.id,
        department_id: allocation.department_id,
        amount: allocation.amount,
        created_by: req.user.id,
        updated_at: new Date()
      })))
      .select('id, request_id, department_id, amount');
    if (insertError) return res.status(400).json({ error: insertError });

    const oldSummary = (existingAllocations || []).map((allocation) => `${allocation.department_id}:${toNumber(allocation.amount).toFixed(2)}`).join(', ') || 'none';
    const newSummary = (savedAllocations || []).map((allocation) => `${allocation.department_id}:${toNumber(allocation.amount).toFixed(2)}`).join(', ');

    await supabase.from('allocation_logs').insert({
      request_id: req.params.id,
      actor_id: req.user.id,
      action: existingAllocations?.length ? 'reallocated' : 'allocated',
      note: `Allocation updated from [${oldSummary}] to [${newSummary}]`
    });

    res.json(savedAllocations || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/requests/:id/reject', authenticate, authorize(['supervisor', 'accounting']), async (req, res) => {
  try {
    const { reason } = req.body;
    const result = await getRequestForUser(req.params.id, req.user);
    if (result.error) {
      return res.status(result.status).json({ error: result.error.message || result.error });
    }

    const request = result.request;
    const stage = req.user.role === 'supervisor' ? 'supervisor' : 'accounting';

    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: 'Rejection reason is required' });
    }

    if (req.user.role === 'supervisor' && request.status !== 'pending_supervisor') {
      return res.status(400).json({ error: 'Only requests waiting for supervisor approval can be rejected here' });
    }

    if (req.user.role === 'accounting' && request.status !== 'pending_accounting') {
      return res.status(400).json({ error: 'Only requests waiting for accounting approval can be rejected here' });
    }

    const { data, error } = await supabase
      .from('expense_requests')
      .update({
        status: 'rejected',
        rejection_reason: String(reason).trim(),
        rejection_stage: stage,
        updated_at: new Date()
      })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) return res.status(400).json({ error });

    await supabase.from('approval_logs').insert({
      request_id: request.id,
      actor_id: req.user.id,
      action: 'rejected',
      stage,
      note: String(reason).trim()
    });

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/requests/:id/return', authenticate, authorize(['supervisor', 'accounting', 'admin']), async (req, res) => {
  try {
    const reason = String(req.body?.reason || '').trim();
    if (!reason) {
      return res.status(400).json({ error: 'A return reason is required.' });
    }

    const result = await getRequestForUser(req.params.id, req.user);
    if (result.error) {
      return res.status(result.status).json({ error: result.error.message || result.error });
    }

    const request = result.request;
    if (!['pending_supervisor', 'pending_accounting'].includes(request.status)) {
      return res.status(400).json({ error: 'Only pending requests can be returned for revision.' });
    }

    const stage = req.user.role === 'supervisor' ? 'supervisor' : 'accounting';
    const { data, error } = await supabase
      .from('expense_requests')
      .update({
        status: 'returned_for_revision',
        returned_by: req.user.id,
        returned_at: new Date(),
        return_reason: reason,
        updated_at: new Date()
      })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message || error });

    await supabase.from('approval_logs').insert({
      request_id: request.id,
      actor_id: req.user.id,
      action: 'returned',
      stage,
      note: reason
    });

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/requests/:id/resubmit', authenticate, authorize(['employee']), async (req, res) => {
  try {
    const purpose = String(req.body?.purpose || '').trim();
    const result = await getRequestForUser(req.params.id, req.user);
    if (result.error) {
      return res.status(result.status).json({ error: result.error.message || result.error });
    }

    const request = result.request;
    if (request.employee_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (request.status !== 'returned_for_revision') {
      return res.status(400).json({ error: 'Only returned requests can be resubmitted.' });
    }

    const { data, error } = await supabase
      .from('expense_requests')
      .update({
        status: 'pending_supervisor',
        purpose: purpose || request.purpose,
        submitted_at: new Date(),
        returned_by: null,
        returned_at: null,
        return_reason: null,
        revision_count: Number(request.revision_count || 0) + 1,
        updated_at: new Date()
      })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message || error });

    await supabase.from('approval_logs').insert({
      request_id: request.id,
      actor_id: req.user.id,
      action: 'submitted',
      stage: 'supervisor',
      note: 'Request resubmitted after revision'
    });

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/requests/:id/timeline', authenticate, async (req, res) => {
  try {
    const result = await getRequestForUser(req.params.id, req.user);
    if (result.error) {
      return res.status(result.status).json({ error: result.error.message || result.error });
    }

      const [approvalLogsResult, allocationLogsResult] = await Promise.all([
        supabase.from('approval_logs').select('*').eq('request_id', req.params.id),
        supabase.from('allocation_logs').select('*').eq('request_id', req.params.id)
      ]);

      if (approvalLogsResult.error) return res.status(400).json({ error: approvalLogsResult.error });
      if (allocationLogsResult.error) return res.status(400).json({ error: allocationLogsResult.error });
      const approvalLogs = (approvalLogsResult.data || []).map((log) => ({
        ...log,
        event_time: log.timestamp,
        approval_side: log.stage === 'supervisor' ? 'supervisor' : ['accounting', 'finance'].includes(log.stage) ? 'accounting' : 'general'
      }));
      const allocationLogs = (allocationLogsResult.data || []).map((log) => ({
        ...log,
        stage: 'allocation',
        event_time: log.created_at,
        approval_side: 'accounting'
      }));
      const combinedLogs = [...approvalLogs, ...allocationLogs].sort(
        (left, right) => new Date(left.event_time).getTime() - new Date(right.event_time).getTime()
      );

      const actorIds = Array.from(new Set(combinedLogs.map((log) => log.actor_id).filter(Boolean)));
      const { data: actors } = actorIds.length
          ? await supabase.from('users').select('id, name, role').in('id', actorIds)
          : { data: [] };
      const actorMap = new Map((actors || []).map((actor) => [actor.id, actor]));
  
      res.json((combinedLogs || []).map((log) => ({
        ...log,
        timestamp: log.event_time,
        actor_name: actorMap.get(log.actor_id)?.name || 'System',
        actor_role: actorMap.get(log.actor_id)?.role || '',
      })));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
});

// Reports routes
app.get('/api/reports/filter-options', authenticate, async (req, res) => {
  try {
    let requestQuery = supabase
      .from('expense_requests')
      .select('category, department_id, fiscal_year')
      .order('category', { ascending: true });

    let departmentQuery = supabase
      .from('departments')
      .select('id, name, fiscal_year')
      .order('name', { ascending: true });

    if (req.user.role === 'employee' || req.user.role === 'supervisor') {
      const accessibleDepartmentIds = await getAccessibleDepartmentIdsForUser(req.user, await getLatestConfiguredFiscalYear());
      if (req.user.role === 'employee') {
        const activeDepartmentId = accessibleDepartmentIds[0] || req.user.department_id;
        requestQuery = requestQuery.eq('department_id', activeDepartmentId);
        departmentQuery = departmentQuery.eq('id', activeDepartmentId);
      } else {
        requestQuery = accessibleDepartmentIds.length
          ? requestQuery.in('department_id', accessibleDepartmentIds)
          : requestQuery.eq('department_id', req.user.department_id);
        departmentQuery = accessibleDepartmentIds.length
          ? departmentQuery.in('id', accessibleDepartmentIds)
          : departmentQuery.eq('id', req.user.department_id);
      }
    }

    const [{ data: requestRows, error: requestError }, { data: departments, error: departmentError }] = await Promise.all([
      requestQuery,
      departmentQuery
    ]);

    if (requestError) return res.status(400).json({ error: requestError });
    if (departmentError) return res.status(400).json({ error: departmentError });

    const uniqueDepartments = new Map();
    (departments || []).forEach((department) => {
      const canonicalName = toCanonicalDepartmentName(department.name);
      const key = normalizeDepartmentKey(canonicalName);
      const current = uniqueDepartments.get(key);

      if (!current || String(department.id) < String(current.id)) {
        uniqueDepartments.set(key, {
          ...department,
          name: canonicalName
        });
      }
    });

    const categories = Array.from(
      new Set(
        (requestRows || [])
          .map((row) => String(row.category || '').trim())
          .filter(Boolean)
      )
    ).sort((left, right) => left.localeCompare(right));

    res.json({
      departments: Array.from(uniqueDepartments.values()).sort((left, right) => left.name.localeCompare(right.name)),
      categories,
      fiscal_years: Array.from(
        new Set(
          [
            ...(requestRows || []).map((row) => Number(row.fiscal_year || 0)),
            ...(departments || []).map((department) => Number(department.fiscal_year || 0))
          ].filter((year) => Number.isInteger(year) && year > 0)
        )
      ).sort((left, right) => right - left)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/reports/summary', authenticate, async (req, res) => {
  try {
    const { dept, from, to, status, category, fiscal_year, archived = 'false' } = req.query;
    let query = supabase.from('expense_requests').select(REQUESTS_REPORT_SELECT);

    if (req.user.role === 'employee') {
      query = query.eq('employee_id', req.user.id);
    } else if (req.user.role === 'supervisor') {
      const accessibleDepartmentIds = await getAccessibleDepartmentIdsForUser(req.user, await getLatestConfiguredFiscalYear());
      query = accessibleDepartmentIds.length
        ? query.in('department_id', accessibleDepartmentIds)
        : query.eq('department_id', req.user.department_id);
    }

    if (dept) query = query.eq('department_id', dept);
    if (fiscal_year) query = query.eq('fiscal_year', Number(fiscal_year));
    if (from) query = query.gte('submitted_at', from);
    if (to) query = query.lte('submitted_at', to);
    if (status) query = query.eq('status', status);
    if (category) query = query.eq('category', category);
    if (archived === 'true') query = query.eq('archived', true);
    else if (archived === 'false') query = query.eq('archived', false);

    const { data: requests, error } = await query;
    if (error) return res.status(400).json({ error });

    const summary = {
      total_requests: requests.length,
      approved: requests.filter(r => r.status === 'approved' || r.status === 'released').length,
      rejected: requests.filter(r => r.status === 'rejected').length,
      total_amount: requests.reduce((sum, r) => sum + parseFloat(r.amount), 0)
    };

    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/reports/requests', authenticate, async (req, res) => {
  try {
    const { dept, from, to, status, category, fiscal_year, archived = 'false' } = req.query;
    let query = supabase.from('expense_requests').select(REQUESTS_REPORT_SELECT);

    if (req.user.role === 'employee') {
      query = query.eq('employee_id', req.user.id);
    } else if (req.user.role === 'supervisor') {
      const accessibleDepartmentIds = await getAccessibleDepartmentIdsForUser(req.user, await getLatestConfiguredFiscalYear());
      query = accessibleDepartmentIds.length
        ? query.in('department_id', accessibleDepartmentIds)
        : query.eq('department_id', req.user.department_id);
    }

    if (dept) query = query.eq('department_id', dept);
    if (fiscal_year) query = query.eq('fiscal_year', Number(fiscal_year));
    if (from) query = query.gte('submitted_at', from);
    if (to) query = query.lte('submitted_at', to);
    if (status) query = query.eq('status', status);
    if (category) query = query.eq('category', category);
    if (archived === 'true') query = query.eq('archived', true);
    else if (archived === 'false') query = query.eq('archived', false);

    const { data, error } = await query.order('submitted_at', { ascending: false });
    if (error) return res.status(400).json({ error });
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Local development server running on http://localhost:${PORT}`);
  console.log(`📱 Frontend available at http://localhost:3000`);
});
