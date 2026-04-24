import express from 'express';
import { authenticate } from '../middleware/auth';
import { supabase } from '../utils/supabase';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { getAccessibleDepartmentIdsForUser, getLatestConfiguredFiscalYear } from '../utils/fiscal';

const router = express.Router();
const normalizeDepartmentName = (value: string) => String(value || '').trim();
const normalizeDepartmentKey = (value: string) => normalizeDepartmentName(value).toLowerCase();
const getDepartmentFilterKey = (department: { name?: string; fiscal_year?: number }) =>
  `${normalizeDepartmentKey(String(department?.name || ''))}::${department?.fiscal_year ?? ''}`;
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
const REQUESTS_DEPARTMENT_SELECT = `
  *,
  departments:departments!fk_expense_requests_department_id(name, fiscal_year)
`;
const REQUESTS_REPORT_SELECT = `
  *,
  users:users!fk_expense_requests_employee_id(name),
  departments:departments!fk_expense_requests_department_id(name, fiscal_year)
`;
const toCanonicalDepartmentName = (value: string) => {
  const normalizedValue = normalizeDepartmentName(value);
  if (!normalizedValue) return '';
  return LEGACY_TO_CANONICAL_DEPARTMENT[normalizeDepartmentKey(normalizedValue)] || normalizedValue;
};

// GET /api/reports/filter-options
router.get('/filter-options', authenticate, async (req: any, res) => {
  const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
  let requestQuery = supabase
    .from('expense_requests')
    .select('category, department_id, fiscal_year')
    .order('category', { ascending: true });

  let departmentQuery = supabase
    .from('departments')
    .select('id, name, fiscal_year')
    .order('name', { ascending: true });

  if (req.user.role === 'employee' || req.user.role === 'supervisor') {
    const accessibleDepartmentIds = await getAccessibleDepartmentIdsForUser(supabase, req.user, activeFiscalYear);
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

  const uniqueDepartments = new Map<string, any>();
  (departments || []).forEach((department: any) => {
    const canonicalName = toCanonicalDepartmentName(department.name);
    const key = getDepartmentFilterKey({ name: canonicalName, fiscal_year: department.fiscal_year });
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
        .map((row: any) => String(row.category || '').trim())
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right));

  res.json({
    departments: Array.from(uniqueDepartments.values()).sort((left: any, right: any) => left.name.localeCompare(right.name)),
    categories,
    fiscal_years: Array.from(
      new Set(
        [
          ...(requestRows || []).map((row: any) => Number(row.fiscal_year || 0)),
          ...(departments || []).map((department: any) => Number(department.fiscal_year || 0))
        ].filter((year) => Number.isInteger(year) && year > 0)
      )
    ).sort((left, right) => right - left)
  });
});

// GET /api/reports/summary?dept=&from=&to=&archived=false&format=json|pdf|excel
router.get('/summary', authenticate, async (req: any, res) => {
  const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
  const { dept, from, to, status, category, fiscal_year, archived = 'false', format } = req.query;
  let query = supabase.from('expense_requests').select(REQUESTS_DEPARTMENT_SELECT);
  if (req.user.role === 'employee') query = query.eq('employee_id', req.user.id);
  else if (req.user.role === 'supervisor') {
    const accessibleDepartmentIds = await getAccessibleDepartmentIdsForUser(supabase, req.user, activeFiscalYear);
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
    total_amount: requests.reduce((sum, r) => sum + parseFloat(r.amount), 0),
    by_status: requests.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {}),
    by_category: requests.reduce((acc, r) => {
      acc[r.category] = (acc[r.category] || 0) + parseFloat(r.amount);
      return acc;
    }, {})
  };

  if (format === 'pdf') {
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=summary.pdf');
    doc.pipe(res);
    doc.fontSize(20).text('Expense Summary Report', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Total Requests: ${summary.total_requests}`);
    doc.text(`Approved: ${summary.approved}`);
    doc.text(`Rejected: ${summary.rejected}`);
    doc.text(`Total Amount: ₱${summary.total_amount.toFixed(2)}`);
    doc.end();
  } else if (format === 'excel') {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Summary');
    worksheet.columns = [
      { header: 'Metric', key: 'metric' },
      { header: 'Value', key: 'value' }
    ];
    worksheet.addRow({ metric: 'Total Requests', value: summary.total_requests });
    worksheet.addRow({ metric: 'Approved', value: summary.approved });
    worksheet.addRow({ metric: 'Rejected', value: summary.rejected });
    worksheet.addRow({ metric: 'Total Amount', value: `₱${summary.total_amount.toFixed(2)}` });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=summary.xlsx');
    await workbook.xlsx.write(res);
  } else {
    res.json(summary);
  }
});

// GET /api/reports/requests?dept=&from=&to=&archived=false&status=&category=&format=json|pdf|excel
router.get('/requests', authenticate, async (req: any, res) => {
  const activeFiscalYear = await getLatestConfiguredFiscalYear(supabase);
  const { dept, from, to, status, category, fiscal_year, archived = 'false', format } = req.query;
  let query = supabase.from('expense_requests').select(REQUESTS_REPORT_SELECT);
  if (req.user.role === 'employee') query = query.eq('employee_id', req.user.id);
  else if (req.user.role === 'supervisor') {
    const accessibleDepartmentIds = await getAccessibleDepartmentIdsForUser(supabase, req.user, activeFiscalYear);
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

  if (format === 'pdf') {
    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=requests.pdf');
    doc.pipe(res);
    doc.fontSize(20).text('Expense Requests Report', { align: 'center' });
    doc.moveDown();
    requests.forEach((r: any) => {
      doc.fontSize(12).text(`Request: ${r.request_code} - ${r.item_name} - ₱${r.amount} - ${r.status}`);
    });
    doc.end();
  } else if (format === 'excel') {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Requests');
    worksheet.columns = [
      { header: 'Request Code', key: 'request_code' },
      { header: 'Employee', key: 'employee' },
      { header: 'Department', key: 'department' },
      { header: 'Item', key: 'item_name' },
      { header: 'Amount', key: 'amount' },
      { header: 'Status', key: 'status' },
      { header: 'Submitted At', key: 'submitted_at' }
    ];
    requests.forEach((r: any) => {
      worksheet.addRow({
        request_code: r.request_code,
        employee: r.users?.name,
        department: r.departments?.name,
        item_name: r.item_name,
        amount: r.amount,
        status: r.status,
        submitted_at: r.submitted_at
      });
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=requests.xlsx');
    await workbook.xlsx.write(res);
  } else {
    res.json(requests);
  }
});

export default router;
