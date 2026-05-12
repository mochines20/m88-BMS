const { supabase } = require('../utils/supabase');
const { authenticate, authorize } = require('../utils/auth');
const { validateExpense } = require('../utils/expenseValidator');

const toNumber = (value) => Number.parseFloat(value ?? 0) || 0;
const toText = (value) => String(value ?? '').trim();

// Input validation helpers
const validateUUID = (uuid) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};

const sanitizeText = (text) => {
  return toText(text).replace(/[<>]/g, '').substring(0, 500);
};

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST' && event.httpMethod !== 'PATCH') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const token = event.headers.authorization;
    const user = authenticate(token);
    
    authorize(['employee', 'manager', 'supervisor', 'accounting'])(user);

    const { advance_id, items, fiscal_year } = JSON.parse(event.body);
    const targetFiscalYear = fiscal_year ? parseInt(fiscal_year) : new Date().getFullYear();

    // Validate advance_id
    if (!validateUUID(advance_id)) {
      return { 
        statusCode: 400, 
        body: JSON.stringify({ error: 'Invalid cash advance ID' }) 
      };
    }

    // Validate items array
    if (!Array.isArray(items) || items.length === 0) {
      return { 
        statusCode: 400, 
        body: JSON.stringify({ error: 'At least one liquidation item is required' }) 
      };
    }

    // Get cash advance details
    const { data: cashAdvance, error: advanceError } = await supabase
      .from('cash_advances')
      .select('*')
      .eq('id', advance_id)
      .eq('fiscal_year', targetFiscalYear)
      .single();

    if (advanceError || !cashAdvance) {
      return { 
        statusCode: 404, 
        body: JSON.stringify({ error: 'Cash advance not found' }) 
      };
    }

    // Check ownership or permissions
    if (user.role === 'employee' || user.role === 'manager') {
      if (cashAdvance.employee_id !== user.id) {
        return { 
          statusCode: 403, 
          body: JSON.stringify({ error: 'You can only liquidate your own cash advances' }) 
        };
      }
    }

    // Validate and calculate total liquidation amount
    let totalLiquidation = 0;
    const validatedItems = [];

    for (const item of items) {
      const {
        expense_date,
        category_id,
        description,
        amount,
        receipt_attached
      } = item;

      // Validate required fields
      if (!expense_date || !description || !amount) {
        return { 
          statusCode: 400, 
          body: JSON.stringify({ error: 'All liquidation items must have expense_date, description, and amount' }) 
        };
      }

      const itemAmount = toNumber(amount);
      if (itemAmount <= 0 || itemAmount > 999999.99) {
        return { 
          statusCode: 400, 
          body: JSON.stringify({ error: 'Invalid amount in liquidation item' }) 
        };
      }

      // Validate expense date
      const expenseDate = new Date(expense_date);
      if (isNaN(expenseDate.getTime()) || expenseDate > new Date()) {
        return { 
          statusCode: 400, 
          body: JSON.stringify({ error: 'Invalid expense date' }) 
        };
      }

      totalLiquidation += itemAmount;
      validatedItems.push({
        cash_advance_id: advance_id,
        expense_date: expenseDate,
        category_id: category_id || null,
        description: sanitizeText(description),
        amount: itemAmount,
        receipt_attached: Boolean(receipt_attached),
        created_by: user.id
      });
    }

    // Check if liquidation amount exceeds balance
    const currentBalance = toNumber(cashAdvance.balance);
    if (totalLiquidation > currentBalance) {
      return { 
        statusCode: 400, 
        body: JSON.stringify({ 
          error: `Liquidation amount (${totalLiquidation.toFixed(2)}) exceeds cash advance balance (${currentBalance.toFixed(2)})` 
        }) 
      };
    }

    // Create liquidation records
    const { data: liquidationItems, error: liquidationError } = await supabase
      .from('cash_advance_liquidations')
      .insert(validatedItems)
      .select();

    if (liquidationError) throw liquidationError;

    // Update cash advance
    const newAmountLiquidated = toNumber(cashAdvance.amount_liquidated) + totalLiquidation;
    const newBalance = currentBalance - totalLiquidation;
    
    let newStatus = cashAdvance.status;
    if (newBalance <= 0) {
      newStatus = 'fully_liquidated';
    } else if (newStatus === 'outstanding') {
      newStatus = 'partially_liquidated';
    }

    const { data: updatedAdvance, error: updateError } = await supabase
      .from('cash_advances')
      .update({
        amount_liquidated: newAmountLiquidated,
        balance: Math.max(0, newBalance),
        status: newStatus,
        updated_at: new Date()
      })
      .eq('id', advance_id)
      .select()
      .single();

    if (updateError) throw updateError;

    // Create audit log
    await supabase.from('approval_logs').insert({
      request_id: advance_id,
      actor_id: user.id,
      action: 'liquidation_submitted',
      stage: 'liquidation',
      note: `Liquidation submitted: ${items.length} items totaling ₱${totalLiquidation.toFixed(2)}`
    });

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        cash_advance: updatedAdvance,
        liquidation_items: liquidationItems,
        total_liquidated: totalLiquidation
      }),
    };
  } catch (error) {
    console.error('Cash advance liquidation error:', error);
    return {
      statusCode: error.message.includes('Forbidden') ? 403 : 
                 error.message.includes('Access denied') ? 401 : 500,
      body: JSON.stringify({ error: error.message || 'Internal server error' }),
    };
  }
};
