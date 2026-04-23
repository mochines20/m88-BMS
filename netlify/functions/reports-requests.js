const { supabase } = require('../utils/supabase');
const { authenticate } = require('../utils/auth');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const token = event.headers.authorization;
    const user = authenticate(token);
    const params = event.queryStringParameters || {};
    const { dept, from, to, status, category, format } = params;

    let query = supabase.from('expense_requests').select('*, users(name), departments(name)');
    if (user.role === 'employee') query = query.eq('employee_id', user.id);
    else if (user.role === 'supervisor') query = query.eq('department_id', user.department_id);
    if (dept) query = query.eq('department_id', dept);
    if (from) query = query.gte('submitted_at', from);
    if (to) query = query.lte('submitted_at', to);
    if (status) query = query.eq('status', status);
    if (category) query = query.eq('category', category);
    const { data: requests, error } = await query;
    if (error) return { statusCode: 400, body: JSON.stringify({ error }) };

    if (format === 'pdf') {
      const buffers = [];
      const doc = new PDFDocument();
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'attachment; filename=requests.pdf',
            'Access-Control-Allow-Origin': '*'
          },
          body: pdfData.toString('base64'),
          isBase64Encoded: true,
        };
      });

      doc.fontSize(20).text('Expense Requests Report', { align: 'center' });
      doc.moveDown();
      requests.forEach((r) => {
        doc.fontSize(12).text(`Request: ${r.request_code} - ${r.item_name} - ₱${r.amount} - ${r.status}`);
      });
      doc.end();

      await new Promise(resolve => doc.on('end', resolve));
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
      requests.forEach((r) => {
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

      const buffer = await workbook.xlsx.writeBuffer();
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename=requests.xlsx',
          'Access-Control-Allow-Origin': '*'
        },
        body: buffer.toString('base64'),
        isBase64Encoded: true,
      };
    } else {
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(requests),
      };
    }
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};