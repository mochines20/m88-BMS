import axios, { AxiosError } from 'axios';
import toast from 'react-hot-toast';

const API_BASE_URL = import.meta.env.PROD
  ? '/api'
  : import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000, // 30 second timeout
});

// Request interceptor - add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor - handle errors globally
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const errorMessage = getErrorMessage(error);
    
    // Don't show toast for auth endpoints (handled by components)
    const isAuthEndpoint = error.config?.url?.includes('/auth/');
    const isLogin = error.config?.url?.includes('/auth/login');
    
    if (!isLogin && !isAuthEndpoint) {
      toast.error(errorMessage);
    }

    // Handle specific error codes
    if (error.response?.status === 401) {
      // Unauthorized - clear token and redirect to login
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }

    return Promise.reject(error);
  }
);

function getErrorMessage(error: AxiosError): string {
  // Network errors
  if (!error.response) {
    if (error.code === 'ECONNABORTED') {
      return 'Request timed out. Please try again.';
    }
    if (error.code === 'ERR_NETWORK') {
      return 'Network error. Please check your internet connection.';
    }
    return 'Unable to connect to server. Please try again later.';
  }

  // Server errors with custom messages
  const data = error.response.data as any;
  
  // Handle Supabase-style errors: {code, details, hint, message}
  if (data?.message && typeof data.message === 'string') {
    return data.message;
  }
  
  // Handle nested error objects
  if (data?.error) {
    if (typeof data.error === 'string') {
      return data.error;
    }
    if (data.error?.message && typeof data.error.message === 'string') {
      return data.error.message;
    }
  }

  // HTTP status based messages
  switch (error.response.status) {
    case 400:
      return 'Invalid request. Please check your input.';
    case 401:
      return 'Session expired. Please log in again.';
    case 403:
      return 'You do not have permission to perform this action.';
    case 404:
      return 'The requested resource was not found.';
    case 409:
      return 'A conflict occurred. Please try again.';
    case 422:
      return 'Validation failed. Please check your input.';
    case 429:
      return 'Too many requests. Please wait a moment.';
    case 500:
      return 'Server error. Please try again later.';
    case 502:
      return 'Service temporarily unavailable. Please try again later.';
    case 503:
      return 'Service is under maintenance. Please try again later.';
    default:
      return 'An unexpected error occurred. Please try again.';
  }
}

export default api;
