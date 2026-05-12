const { supabase } = require('../utils/supabase');
const { 
  checkAuthRateLimit, 
  sanitizeEmail, 
  sanitizePassword, 
  verifyPassword, 
  generateSecureToken,
  createErrorResponse 
} = require('../utils/enhancedAuth');

const jwt = require('jsonwebtoken');

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify(createErrorResponse('Method not allowed', 405)) };
  }

  try {
    const { email, password } = JSON.parse(event.body);
    
    // Get client IP for rate limiting
    const clientIP = event.headers['x-forwarded-for'] || 
                   event.headers['x-real-ip'] || 
                   event.requestContext.identity.sourceIp;

    // Apply rate limiting
    try {
      checkAuthRateLimit(sanitizeEmail(email));
    } catch (rateLimitError) {
      return { 
        statusCode: 429, 
        body: JSON.stringify(createErrorResponse(rateLimitError.message, 429)) 
      };
    }

    // Sanitize and validate inputs
    const cleanEmail = sanitizeEmail(email);
    const cleanPassword = sanitizePassword(password);

    const { data: user, error } = await supabase
      .from('users')
      .select('id, name, email, role, department_id, password_hash')
      .eq('email', cleanEmail)
      .single();

    if (error || !user) {
      return { 
        statusCode: 400, 
        body: JSON.stringify(createErrorResponse('Invalid email or password', 400)) 
      };
    }

    const valid = await verifyPassword(cleanPassword, user.password_hash);
    if (!valid) {
      return { 
        statusCode: 400, 
        body: JSON.stringify(createErrorResponse('Invalid email or password', 400)) 
      };
    }

    // Generate JWT token with enhanced security
    const token = jwt.sign(
      { 
        id: user.id, 
        role: user.role, 
        department_id: user.department_id,
        sessionId: generateSecureToken(16) // Add session identifier
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Remove sensitive data before returning
    const { password_hash, ...userWithoutPassword } = user;

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY'
      },
      body: JSON.stringify({
        token,
        user: { 
          id: user.id, 
          name: user.name, 
          role: user.role,
          department_id: user.department_id 
        },
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour
      }),
    };
  } catch (error) {
    console.error('Login error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify(createErrorResponse('Authentication service temporarily unavailable', 500)),
    };
  }
};