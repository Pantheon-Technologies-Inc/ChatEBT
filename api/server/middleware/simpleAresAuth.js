const { logger } = require('@librechat/data-schemas');
const { hasValidAresTokens } = require('~/utils/aresClient');

/**
 * Simple ARES authentication middleware
 * Only checks if user has ARES tokens when needed
 * Much simpler than the complex auto-logout middleware
 */

/**
 * Require valid ARES tokens for specific routes
 * @param {Object} options - Configuration options
 * @param {boolean} options.optional - If true, don't block request if no tokens
 * @returns {Function} Express middleware function
 */
function requireAresAuth(options = {}) {
  const { optional = false } = options;

  return async (req, res, next) => {
    try {
      const userId = req.user?.id || req.user?._id;

      // Skip if no user (let other middleware handle auth)
      if (!userId) {
        return next();
      }

      // Check if user has valid ARES tokens
      const hasTokens = await hasValidAresTokens(userId);

      if (!hasTokens) {
        logger.info('[simpleAresAuth] User lacks valid ARES tokens', {
          userId: userId.substring(0, 8) + '...',
          path: req.path,
          method: req.method,
          optional
        });

        if (optional) {
          // Add flag to request indicating missing ARES auth
          req.missingAresAuth = true;
          return next();
        }

        // Return auth required response
        return res.status(401).json({
          error: 'ARES_AUTH_REQUIRED',
          message: 'ARES authentication required. Please sign in with ARES.',
          redirectUrl: '/oauth/ares',
          timestamp: new Date().toISOString(),
        });
      }

      // User has valid tokens
      req.hasAresAuth = true;
      next();

    } catch (error) {
      logger.error('[simpleAresAuth] Error checking ARES authentication', {
        userId: req.user?.id?.substring(0, 8) + '...' || 'unknown',
        error: error.message,
        path: req.path
      });

      if (optional) {
        req.missingAresAuth = true;
        return next();
      }

      return res.status(500).json({
        error: 'AUTHENTICATION_ERROR',
        message: 'Authentication service error. Please try again.',
        timestamp: new Date().toISOString(),
      });
    }
  };
}

/**
 * Optional ARES auth - adds flag but doesn't block
 */
const optionalAresAuth = requireAresAuth({ optional: true });

module.exports = {
  requireAresAuth,
  optionalAresAuth,
};