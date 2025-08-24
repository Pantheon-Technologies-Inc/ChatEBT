const { logger } = require('@librechat/data-schemas');

/**
 * Input validation and sanitization for ARES-related operations
 * Security-focused validation to prevent injection attacks
 */

/**
 * Validate user ID format
 * @param {string} userId - User ID to validate
 * @returns {boolean} True if valid
 */
function isValidUserId(userId) {
  // MongoDB ObjectId is 24 hex characters
  if (typeof userId !== 'string') return false;
  if (userId.length !== 24) return false;
  if (!/^[a-f0-9]{24}$/i.test(userId)) return false;
  return true;
}

/**
 * Validate ARES endpoint name
 * @param {string} endpoint - Endpoint to validate
 * @returns {boolean} True if valid
 */
function isValidEndpoint(endpoint) {
  if (typeof endpoint !== 'string') return false;
  if (endpoint.length === 0 || endpoint.length > 100) return false;
  
  // Allow only alphanumeric, hyphens, underscores, and slashes
  if (!/^[a-zA-Z0-9\-_\/]+$/.test(endpoint)) return false;
  
  // Prevent path traversal
  if (endpoint.includes('..') || endpoint.includes('./')) return false;
  
  return true;
}

/**
 * Validate and sanitize API response data
 * @param {Object} data - Response data to validate
 * @returns {Object} Sanitized data
 */
function sanitizeAresResponse(data) {
  if (!data || typeof data !== 'object') {
    return {};
  }

  const sanitized = {};

  // Validate user object
  if (data.user && typeof data.user === 'object') {
    sanitized.user = {};
    
    // Validate user ID
    if (typeof data.user.id === 'string' && data.user.id.length <= 100) {
      sanitized.user.id = data.user.id.trim();
    }
    
    // Validate email
    if (typeof data.user.email === 'string' && data.user.email.length <= 255) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (emailRegex.test(data.user.email)) {
        sanitized.user.email = data.user.email.toLowerCase().trim();
      }
    }
    
    // Validate credits (must be non-negative number)
    if (typeof data.user.credits === 'number' && data.user.credits >= 0 && Number.isFinite(data.user.credits)) {
      sanitized.user.credits = Math.floor(data.user.credits);
    } else {
      sanitized.user.credits = 0;
    }
    
    // Validate name
    if (typeof data.user.name === 'string' && data.user.name.length <= 200) {
      sanitized.user.name = data.user.name.trim();
    }
  }

  return sanitized;
}

/**
 * Rate limiting for ARES API calls
 */
class AresRateLimiter {
  constructor() {
    this.userRequests = new Map();
    this.windowMs = 60 * 1000; // 1 minute window
    this.maxRequests = 60; // Max 60 requests per minute per user
  }

  /**
   * Check if user is within rate limits
   * @param {string} userId - User ID
   * @returns {boolean} True if within limits
   */
  checkRateLimit(userId) {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    if (!this.userRequests.has(userId)) {
      this.userRequests.set(userId, []);
    }

    const userReqs = this.userRequests.get(userId);
    
    // Remove old requests outside the window
    const validReqs = userReqs.filter(timestamp => timestamp > windowStart);
    this.userRequests.set(userId, validReqs);

    // Check if user is over the limit
    if (validReqs.length >= this.maxRequests) {
      logger.warn('[aresValidation] Rate limit exceeded', {
        userId: userId.substring(0, 8) + '...',
        requests: validReqs.length,
        limit: this.maxRequests,
        windowMs: this.windowMs
      });
      return false;
    }

    // Add current request
    validReqs.push(now);
    this.userRequests.set(userId, validReqs);

    return true;
  }

  /**
   * Clean up old entries to prevent memory leaks
   */
  cleanup() {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    for (const [userId, requests] of this.userRequests) {
      const validReqs = requests.filter(timestamp => timestamp > windowStart);
      
      if (validReqs.length === 0) {
        this.userRequests.delete(userId);
      } else {
        this.userRequests.set(userId, validReqs);
      }
    }
  }
}

// Global rate limiter instance
const rateLimiter = new AresRateLimiter();

// Clean up rate limiter every 5 minutes
setInterval(() => {
  rateLimiter.cleanup();
}, 5 * 60 * 1000);

/**
 * Validate request headers for security
 * @param {Object} headers - Request headers
 * @returns {Object} Sanitized headers
 */
function sanitizeRequestHeaders(headers) {
  const sanitized = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'ChatEBT/1.0',
  };

  // Only allow specific headers through
  const allowedHeaders = ['authorization'];
  
  for (const header of allowedHeaders) {
    if (headers[header] && typeof headers[header] === 'string') {
      // Basic validation - no control characters
      if (!/[\x00-\x1f\x7f]/.test(headers[header])) {
        sanitized[header] = headers[header];
      }
    }
  }

  return sanitized;
}

/**
 * Validate environment configuration
 * @returns {boolean} True if configuration is valid
 */
function validateEnvironmentConfig() {
  const required = ['ARES_CLIENT_ID', 'ARES_CLIENT_SECRET'];
  const missing = [];

  for (const key of required) {
    if (!process.env[key] || typeof process.env[key] !== 'string' || process.env[key].trim().length === 0) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    logger.error('[aresValidation] Missing required environment variables', {
      missing,
      timestamp: new Date().toISOString()
    });
    return false;
  }

  // Validate client ID format (basic)
  if (process.env.ARES_CLIENT_ID.length < 3 || process.env.ARES_CLIENT_ID.length > 100) {
    logger.error('[aresValidation] Invalid ARES_CLIENT_ID format');
    return false;
  }

  // Validate client secret format (basic)
  if (process.env.ARES_CLIENT_SECRET.length < 10 || process.env.ARES_CLIENT_SECRET.length > 500) {
    logger.error('[aresValidation] Invalid ARES_CLIENT_SECRET format');
    return false;
  }

  return true;
}

/**
 * Security headers for ARES-related responses
 */
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0'
};

/**
 * Apply security headers to response
 * @param {Object} res - Express response object
 */
function applySecurityHeaders(res) {
  for (const [header, value] of Object.entries(securityHeaders)) {
    res.setHeader(header, value);
  }
}

module.exports = {
  isValidUserId,
  isValidEndpoint,
  sanitizeAresResponse,
  sanitizeRequestHeaders,
  validateEnvironmentConfig,
  applySecurityHeaders,
  rateLimiter,
  AresRateLimiter,
};