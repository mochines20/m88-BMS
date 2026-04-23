const { supabase } = require('../utils/supabase');
const { authenticate, authorize } = require('../utils/auth');
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
    const { dept, from, to, format } = params;

    let query = supabase.from('expense_requests').select('*, departments(name)');
    if (dept) query = query.eq('department_id', dept);
    if (from) query = query.gte('submitted_at', from);
    if (to) query = query.lte('submitted_at', to);
    const { data: requests, error } = await query;
    if (error) return { statusCode: 400, body: JSON.stringify({ error }) };

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
      const buffers = [];
      const doc = new PDFDocument();
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'attachment; filename=summary.pdf',
            'Access-Control-Allow-Origin': '*'
          },
          body: pdfData.toString('base64'),
          isBase64Encoded: true,
        };
      });

      doc.fontSize(20).text('Expense Summary Report', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Total Requests: ${summary.total_requests}`);
      doc.text(`Approved: ${summary.approved}`);
      doc.text(`Rejected: ${summary.rejected}`);
      doc.text(`Total Amount: ₱${summary.total_amount.toFixed(2)}`);
      doc.end();

      // Wait for PDF to finish
      await new Promise(resolve => doc.on('end', resolve));
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

      const buffer = await workbook.xlsx.writeBuffer();
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename=summary.xlsx',
          'Access-Control-Allow-Origin': '*'
        },
        body: buffer.toString('base64'),
        isBase64Encoded: true,
      };
    } else {
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(summary),
      };
    }
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};