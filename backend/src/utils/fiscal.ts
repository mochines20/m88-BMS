export const COMPANY_EMAIL_DOMAIN = 'madison88.com';
export const CANONICAL_DEPARTMENTS = [
  'Admin Department',
  'Finance Department',
  'HR Department',
  'IT Department',
  'Logistics Department',
  'Planning Department',
  'Purchasing Department'
];

export const LEGACY_TO_CANONICAL_DEPARTMENT: Record<string, string> = {
  m88it: 'IT Department',
  m88purchasing: 'Purchasing Department',
  m88planning: 'Planning Department',
  m88logistics: 'Logistics Department',
  m88hr: 'HR Department',
  m88accounting: 'Finance Department',
  m88admin: 'Admin Department',
  'accounting department': 'Finance Department'
};

export const normalizeDepartmentName = (value: string) => String(value || '').trim();
export const normalizeDepartmentKey = (value: string) => normalizeDepartmentName(value).toLowerCase();
export const getCurrentFiscalYear = () => new Date().getFullYear();
export const getDefaultPreferredFiscalYear = () => getCurrentFiscalYear();

export const toCanonicalDepartmentName = (value: string) => {
  const normalizedValue = normalizeDepartmentName(value);
  if (!normalizedValue) return '';
  return LEGACY_TO_CANONICAL_DEPARTMENT[normalizeDepartmentKey(normalizedValue)] || normalizedValue;
};

export const getLatestConfiguredFiscalYear = async (supabase: any, fallback = getCurrentFiscalYear()) => {
  const { data, error } = await supabase
    .from('departments')
    .select('fiscal_year')
    .order('fiscal_year', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return fallback;
  }

  const year = Number(data?.fiscal_year || 0);
  return Number.isInteger(year) && year > 0 ? year : fallback;
};

const getDepartmentTimestamp = (department: { updated_at?: string; created_at?: string }) =>
  new Date(String(department.updated_at || department.created_at || 0)).getTime();

export const pickMostRelevantDepartment = <T extends { fiscal_year?: number; updated_at?: string; created_at?: string }>(
  departments: T[],
  preferredFiscalYear = getCurrentFiscalYear()
) =>
  [...departments].sort((left, right) => {
    const leftPreferred = Number(left.fiscal_year) === preferredFiscalYear ? 1 : 0;
    const rightPreferred = Number(right.fiscal_year) === preferredFiscalYear ? 1 : 0;
    if (rightPreferred !== leftPreferred) return rightPreferred - leftPreferred;

    const leftYear = Number(left.fiscal_year || 0);
    const rightYear = Number(right.fiscal_year || 0);
    if (rightYear !== leftYear) return rightYear - leftYear;

    return getDepartmentTimestamp(right) - getDepartmentTimestamp(left);
  })[0] || null;

export const resolveActiveDepartmentForDepartmentId = async (
  supabase: any,
  departmentId?: string | null,
  preferredFiscalYear?: number | null
) => {
  const normalizedDepartmentId = String(departmentId || '').trim();
  if (!normalizedDepartmentId) {
    return { currentDepartment: null, activeDepartment: null, relatedDepartments: [] as any[] };
  }

  const { data: currentDepartment, error: currentDepartmentError } = await supabase
    .from('departments')
    .select('id, name, fiscal_year, annual_budget, used_budget, petty_cash_balance, updated_at, created_at')
    .eq('id', normalizedDepartmentId)
    .maybeSingle();

  if (currentDepartmentError || !currentDepartment) {
    return { currentDepartment: null, activeDepartment: null, relatedDepartments: [] as any[] };
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
    activeDepartment:
      pickMostRelevantDepartment(
        relatedDepartments,
        preferredFiscalYear ?? (await getLatestConfiguredFiscalYear(supabase, getCurrentFiscalYear()))
      ) || currentDepartment,
    relatedDepartments
  };
};

export const getAccessibleDepartmentIdsForUser = async (
  supabase: any,
  user: { role?: string; department_id?: string | null },
  preferredFiscalYear?: number | null
) => {
  if (!user?.department_id) {
    return [];
  }

  if (user.role !== 'supervisor') {
    const { activeDepartment } = await resolveActiveDepartmentForDepartmentId(supabase, user.department_id, preferredFiscalYear);
    return activeDepartment?.id ? [activeDepartment.id] : [user.department_id];
  }

  const { relatedDepartments, activeDepartment } = await resolveActiveDepartmentForDepartmentId(
    supabase,
    user.department_id,
    preferredFiscalYear
  );

  if (relatedDepartments.length) {
    return relatedDepartments.map((department: any) => department.id);
  }

  return activeDepartment?.id ? [activeDepartment.id] : [user.department_id];
};

export const syncUserDepartmentToActiveYear = async (
  supabase: any,
  userId: string,
  currentDepartmentId?: string | null,
  preferredFiscalYear?: number | null
) => {
  const { activeDepartment } = await resolveActiveDepartmentForDepartmentId(supabase, currentDepartmentId, preferredFiscalYear);
  if (!activeDepartment) return null;

  if (activeDepartment.id !== currentDepartmentId) {
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

export const ensureDepartmentsForFiscalYear = async (
  supabase: any,
  fiscalYear: number,
  options?: { seedName?: string; seedAnnualBudget?: number }
) => {
  const { data: departments, error } = await supabase
    .from('departments')
    .select('id, name, fiscal_year, annual_budget, petty_cash_balance, used_budget, updated_at, created_at')
    .order('fiscal_year', { ascending: false })
    .order('updated_at', { ascending: false });

  if (error) {
    throw error;
  }

  const seedCanonicalName = toCanonicalDepartmentName(options?.seedName || '');
  const departmentMap = new Map<string, any[]>();

  (departments || []).forEach((department: any) => {
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
        canonicalName === seedCanonicalName && typeof options?.seedAnnualBudget === 'number'
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
    if (insertError) {
      throw insertError;
    }
  }

  const { data: yearDepartments, error: yearDepartmentsError } = await supabase
    .from('departments')
    .select('*')
    .eq('fiscal_year', fiscalYear)
    .order('name', { ascending: true });

  if (yearDepartmentsError) {
    throw yearDepartmentsError;
  }

  return yearDepartments || [];
};
