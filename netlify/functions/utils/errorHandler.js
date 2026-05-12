// Standardized error handling utility for Netlify functions

const createErrorResponse = (message, statusCode = 500, details = null, requestId = null) => {
  const error = {
    error: message,
    timestamp: new Date().toISOString(),
    statusCode,
    requestId: requestId || generateRequestId()
  };
  
  if (details) {
    error.details = details;
  }
  
  // Add stack trace in development
  if (process.env.NODE_ENV !== 'production') {
    error.stack = new Error().stack;
  }
  
  return error;
};

const generateRequestId = () => {
  return Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15);
};

const handleDatabaseError = (error) => {
  console.error('Database error:', error);
  
  // Supabase specific error handling
  if (error.code) {
    switch (error.code) {
      case '23505': // Unique violation
        return createErrorResponse('Duplicate entry detected', 409, error.details);
      case '23503': // Foreign key violation
        return createErrorResponse('Referenced record not found', 400, error.details);
      case '23502': // Not null violation
        return createErrorResponse('Required field is missing', 400, error.details);
      case '42501': // Insufficient privilege
        return createErrorResponse('Insufficient permissions', 403, error.details);
      case 'PGRST116': // PostgREST not found
        return createErrorResponse('Resource not found', 404, error.details);
      case 'PGRST301': // PostgREST relation not found
        return createErrorResponse('Invalid resource reference', 400, error.details);
      default:
        return createErrorResponse('Database operation failed', 500, error.message);
    }
  }
  
  // Generic database errors
  if (error.message) {
    if (error.message.includes('timeout')) {
      return createErrorResponse('Database timeout. Please try again', 504, error.message);
    }
    if (error.message.includes('connection')) {
      return createErrorResponse('Database connection error', 503, error.message);
    }
  }
  
  return createErrorResponse('Database operation failed', 500, error.message);
};

const handleValidationError = (error) => {
  console.error('Validation error:', error);
  
  const validationErrors = [];
  
  if (Array.isArray(error)) {
    error.forEach(err => {
      validationErrors.push({
        field: err.field || 'unknown',
        message: err.message || 'Invalid value',
        value: err.value
      });
    });
  } else if (typeof error === 'object' && error.field) {
    validationErrors.push({
      field: error.field,
      message: error.message || 'Invalid value',
      value: error.value
    });
  } else {
    validationErrors.push({
      field: 'general',
      message: error.message || 'Validation failed'
    });
  }
  
  return createErrorResponse('Validation failed', 400, { validationErrors });
};

const handleAuthError = (error) => {
  console.error('Authentication error:', error);
  
  if (error.name === 'TokenExpiredError') {
    return createErrorResponse('Session expired. Please log in again', 401);
  }
  
  if (error.name === 'JsonWebTokenError') {
    return createErrorResponse('Invalid authentication token', 401);
  }
  
  if (error.message.includes('Access denied')) {
    return createErrorResponse('Access denied', 401);
  }
  
  if (error.message.includes('Forbidden')) {
    return createErrorResponse('Insufficient permissions', 403);
  }
  
  if (error.message.includes('Rate limit')) {
    return createErrorResponse(error.message, 429);
  }
  
  return createErrorResponse('Authentication failed', 401, error.message);
};

const handleNetworkError = (error) => {
  console.error('Network error:', error);
  
  if (error.code === 'ECONNABORTED') {
    return createErrorResponse('Request timeout. Please try again', 504);
  }
  
  if (error.code === 'ERR_NETWORK') {
    return createErrorResponse('Network connection failed', 503);
  }
  
  if (error.code === 'ENOTFOUND') {
    return createErrorResponse('Service not available', 503);
  }
  
  return createErrorResponse('Network error occurred', 503, error.message);
};

const wrapAsyncHandler = (handler) => {
  return async (event, context) => {
    const requestId = generateRequestId();
    
    try {
      // Add request ID to context for logging
      context.requestId = requestId;
      
      const result = await handler(event, context);
      
      // Add request ID to successful responses
      if (result.headers) {
        result.headers['X-Request-ID'] = requestId;
      }
      
      return result;
    } catch (error) {
      console.error(`[${requestId}] Unhandled error:`, error);
      
      // Categorize and handle different error types
      let errorResponse;
      
      if (error.code && error.code.startsWith('23')) {
        errorResponse = handleDatabaseError(error);
      } else if (error.name === 'ValidationError' || error.field) {
        errorResponse = handleValidationError(error);
      } else if (error.name?.includes('Token') || error.message?.includes('Access') || error.message?.includes('Forbidden')) {
        errorResponse = handleAuthError(error);
      } else if (error.code?.startsWith('E') || error.code === 'ERR_NETWORK') {
        errorResponse = handleNetworkError(error);
      } else {
        errorResponse = createErrorResponse(
          process.env.NODE_ENV === 'production' 
            ? 'An unexpected error occurred' 
            : error.message || 'Unknown error',
          500,
          process.env.NODE_ENV === 'production' ? null : error.stack
        );
      }
      
      return {
        statusCode: errorResponse.statusCode,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'X-Request-ID': requestId
        },
        body: JSON.stringify(errorResponse)
      };
    }
  };
};

module.exports = {
  createErrorResponse,
  generateRequestId,
  handleDatabaseError,
  handleValidationError,
  handleAuthError,
  handleNetworkError,
  wrapAsyncHandler
};
