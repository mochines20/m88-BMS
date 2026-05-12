const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// Rate limiting store (in production, use Redis or similar)
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX_ATTEMPTS = 5;

// Enhanced authentication with rate limiting and security
const authenticate = (token) => {
  if (!token) {
    throw new Error('Access denied: No token provided');
  }
  
  try {
    const cleanToken = token.replace('Bearer ', '');
    
    // Basic token format validation
    if (!cleanToken || cleanToken.length < 10) {
      throw new Error('Invalid token format');
    }
    
    const decoded = jwt.verify(cleanToken, process.env.JWT_SECRET);
    
    // Validate token payload structure
    if (!decoded.id || !decoded.role) {
      throw new Error('Invalid token structure');
    }
    
    return decoded;
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new Error('Token expired: Please log in again');
    } else if (err.name === 'JsonWebTokenError') {
      throw new Error('Invalid token: Authentication failed');
    } else {
      throw new Error(err.message || 'Authentication failed');
    }
  }
};

// Enhanced authorization with role validation
const authorize = (allowedRoles) => {
  return (user) => {
    if (!user) {
      throw new Error('Access denied: User not authenticated');
    }
    
    if (!user.role) {
      throw new Error('Access denied: User role not specified');
    }
    
    if (!Array.isArray(allowedRoles) || allowedRoles.length === 0) {
      throw new Error('Access denied: Invalid role configuration');
    }
    
    if (!allowedRoles.includes(user.role)) {
      throw new Error(`Access denied: Role '${user.role}' not authorized for this action`);
    }
  };
};

// Rate limiting helper
const checkRateLimit = (identifier, maxAttempts = RATE_LIMIT_MAX_ATTEMPTS) => {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;
  
  if (!rateLimitStore.has(identifier)) {
    rateLimitStore.set(identifier, []);
  }
  
  const attempts = rateLimitStore.get(identifier);
  
  // Remove old attempts outside the window
  const validAttempts = attempts.filter(timestamp => timestamp > windowStart);
  rateLimitStore.set(identifier, validAttempts);
  
  if (validAttempts.length >= maxAttempts) {
    const oldestAttempt = Math.min(...validAttempts);
    const resetTime = new Date(oldestAttempt + RATE_LIMIT_WINDOW);
    throw new Error(`Rate limit exceeded. Try again after ${resetTime.toLocaleTimeString()}`);
  }
  
  // Add current attempt
  validAttempts.push(now);
  return true;
};

// Email-based rate limiting for auth endpoints
const checkAuthRateLimit = (email) => {
  const identifier = `auth_${email.toLowerCase()}`;
  return checkRateLimit(identifier, 5); // 5 attempts per 15 minutes
};

// IP-based rate limiting for general endpoints
const checkIPRateLimit = (ip) => {
  const identifier = `ip_${ip}`;
  return checkRateLimit(identifier, 100); // 100 requests per 15 minutes
};

// Input sanitization helpers
const sanitizeEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const cleanEmail = String(email || '').toLowerCase().trim();
  
  if (!emailRegex.test(cleanEmail)) {
    throw new Error('Invalid email format');
  }
  
  return cleanEmail;
};

const sanitizePassword = (password) => {
  if (!password || typeof password !== 'string') {
    throw new Error('Password is required');
  }
  
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters long');
  }
  
  if (password.length > 128) {
    throw new Error('Password is too long');
  }
  
  // Check for common weak patterns
  if (/(.)\1{2,}/.test(password)) {
    throw new Error('Password cannot contain 3 or more repeated characters');
  }
  
  return password;
};

const sanitizeText = (text, maxLength = 500) => {
  if (text === null || text === undefined) return '';
  
  const cleanText = String(text).trim();
  
  // Remove potentially dangerous characters
  const sanitized = cleanText
    .replace(/[<>]/g, '') // Remove HTML tags
    .replace(/javascript:/gi, '') // Remove JS protocol
    .replace(/on\w+=/gi, '') // Remove event handlers
    .substring(0, maxLength);
  
  return sanitized;
};

const validateUUID = (uuid) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid || !uuidRegex.test(uuid)) {
    throw new Error('Invalid UUID format');
  }
  return uuid;
};

const validateAmount = (amount) => {
  const num = Number.parseFloat(amount);
  
  if (isNaN(num) || num <= 0) {
    throw new Error('Amount must be a positive number');
  }
  
  if (num > 999999.99) {
    throw new Error('Amount exceeds maximum limit');
  }
  
  return Math.round(num * 100) / 100; // Round to 2 decimal places
};

// Enhanced password hashing with configurable rounds
const hashPassword = async (password, rounds = 12) => {
  try {
    return await bcrypt.hash(sanitizePassword(password), rounds);
  } catch (error) {
    throw new Error('Password hashing failed');
  }
};

// Enhanced password verification
const verifyPassword = async (password, hash) => {
  try {
    return await bcrypt.compare(sanitizePassword(password), hash);
  } catch (error) {
    throw new Error('Password verification failed');
  }
};

// Generate secure random token
const generateSecureToken = (length = 32) => {
  return crypto.randomBytes(length).toString('hex');
};

// Standardized error response
const createErrorResponse = (message, statusCode = 500, details = null) => {
  const error = {
    error: message,
    timestamp: new Date().toISOString(),
    statusCode
  };
  
  if (details) {
    error.details = details;
  }
  
  return error;
};

module.exports = {
  authenticate,
  authorize,
  checkRateLimit,
  checkAuthRateLimit,
  checkIPRateLimit,
  sanitizeEmail,
  sanitizePassword,
  sanitizeText,
  validateUUID,
  validateAmount,
  hashPassword,
  verifyPassword,
  generateSecureToken,
  createErrorResponse
};
