/**
 * ARES Token Check Middleware
 *
 * This middleware automatically logs out users when their ARES tokens are invalid/expired.
 * It enforces that all authenticated users must have valid ARES tokens to use the system.
 */

const { logger } = require('@librechat/data-schemas');
const { shouldAutoLogout, autoLogoutUser } = require('~/utils/aresTokens');

/**
 * Middleware that checks ARES token validity and auto-logs out users with invalid tokens.
 * This ensures that only users with valid ARES authentication can access the system.
 *
 * @param {Object} options - Configuration options
 * @param {boolean} options.skipRoutes - Array of route patterns to skip checking
 * @param {boolean} options.logOnly - Only log violations, don't actually logout (for testing)
 * @returns {Function} Express middleware function
 */
function aresTokenCheckMiddleware(options = {}) {
  const { skipRoutes = ['/api/auth/', '/api/oauth/', '/health', '/api/config'], logOnly = false } =
    options;

  return async (req, res, next) => {
    try {
      // Skip check for certain routes (auth, oauth, health checks, etc.)
      const shouldSkip = skipRoutes.some((pattern) => req.path.startsWith(pattern));
      if (shouldSkip) {
        return next();
      }

      // Skip if user is not authenticated (let other middleware handle it)
      const userId = req.user?.id || req.user?._id;
      if (!userId) {
        return next();
      }

      // Check if user should be auto-logged out due to ARES token issues
      const shouldLogout = await shouldAutoLogout(userId);

      if (shouldLogout) {
        logger.warn('[aresTokenCheck] User should be auto-logged out due to invalid ARES tokens', {
          userId,
          path: req.path,
          method: req.method,
          userAgent: req.get('User-Agent'),
          timestamp: new Date().toISOString(),
        });

        if (logOnly) {
          // Only log, don't actually logout (useful for testing/monitoring)
          logger.info('[aresTokenCheck] Log-only mode: would have logged out user', { userId });
          return next();
        }

        // Perform automatic logout
        const logoutSuccess = await autoLogoutUser(req, res, 'Invalid ARES tokens detected');

        if (logoutSuccess) {
          // Send response indicating automatic logout
          return res.status(401).json({
            error: 'ARES_AUTH_EXPIRED',
            message: 'Your ARES authentication has expired. Please sign in again.',
            redirectUrl: '/login',
            autoLogout: true,
          });
        } else {
          // Logout failed, but still deny access
          logger.error('[aresTokenCheck] Auto-logout failed but denying access anyway', { userId });
          return res.status(401).json({
            error: 'ARES_AUTH_REQUIRED',
            message: 'ARES authentication required. Please sign in.',
            redirectUrl: '/login',
          });
        }
      }

      // User has valid ARES tokens, continue
      next();
    } catch (error) {
      logger.error('[aresTokenCheck] Error in ARES token check middleware:', error);

      // On error, deny access for security
      return res.status(500).json({
        error: 'AUTHENTICATION_ERROR',
        message: 'Authentication service error. Please try again.',
      });
    }
  };
}

/**
 * Lightweight middleware that only checks if user has ARES tokens without auto-logout.
 * Useful for routes that need ARES access but shouldn't force logout.
 *
 * @returns {Function} Express middleware function
 */
function requireAresTokens() {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id || req.user?._id;

      if (!userId) {
        return res.status(401).json({
          error: 'USER_NOT_AUTHENTICATED',
          message: 'User authentication required',
        });
      }

      const shouldLogout = await shouldAutoLogout(userId);

      if (shouldLogout) {
        return res.status(401).json({
          error: 'ARES_AUTH_REQUIRED',
          message: 'Valid ARES authentication required to access this resource.',
          redirectUrl: '/auth/ares',
        });
      }

      next();
    } catch (error) {
      logger.error('[requireAresTokens] Error checking ARES token requirement:', error);
      return res.status(500).json({
        error: 'AUTHENTICATION_ERROR',
        message: 'Authentication service error. Please try again.',
      });
    }
  };
}

/**
 * Middleware for checking ARES tokens on startup/critical operations.
 * This is more aggressive and always enforces logout for invalid tokens.
 *
 * @returns {Function} Express middleware function
 */
function strictAresTokenCheck() {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id || req.user?._id;

      if (!userId) {
        return next();
      }

      const shouldLogout = await shouldAutoLogout(userId);

      if (shouldLogout) {
        logger.info('[strictAresTokenCheck] Enforcing logout for invalid ARES tokens', { userId });

        const logoutSuccess = await autoLogoutUser(req, res, 'Strict ARES token validation failed');

        if (logoutSuccess) {
          return res.status(401).json({
            error: 'ARES_AUTH_EXPIRED',
            message: 'Your ARES authentication has expired. You have been logged out.',
            redirectUrl: '/login',
            autoLogout: true,
            strict: true,
          });
        }
      }

      next();
    } catch (error) {
      logger.error('[strictAresTokenCheck] Error in strict ARES token check:', error);
      return res.status(500).json({
        error: 'AUTHENTICATION_ERROR',
        message: 'Authentication service error.',
      });
    }
  };
}

module.exports = {
  aresTokenCheckMiddleware,
  requireAresTokens,
  strictAresTokenCheck,
};
