/**
 * Example usage of ARES token utilities for making authenticated API calls.
 * This file demonstrates how to use the ARES token system to access protected resources.
 */

const {
  getAresAccessToken,
  callAresAPI,
  getAresUserProfile,
  hasValidAresToken,
  refreshAresTokensIfNeeded,
  revokeAresTokens,
  autoLogoutUser,
  shouldAutoLogout,
} = require('../utils/aresTokens');
const {
  aresTokenCheckMiddleware,
  requireAresTokens,
  strictAresTokenCheck,
} = require('../server/middleware/aresTokenCheck');
const { logger } = require('@librechat/data-schemas');

/**
 * Example: Get user's ARES profile with auth handling
 */
async function exampleGetUserProfile(userId) {
  try {
    const profile = await getAresUserProfile(userId);
    console.log('ARES User Profile:', profile);
    return profile;
  } catch (error) {
    if (error.code === 'ARES_AUTH_REQUIRED') {
      console.log('User needs to re-authenticate with ARES');
      // Redirect user to ARES OAuth flow
      return { authRequired: true, redirectUrl: '/auth/ares' };
    }
    console.error('Failed to get ARES profile:', error.message);
    throw error;
  }
}

/**
 * Example: Proactive token refresh (call this periodically)
 */
async function exampleProactiveRefresh(userId) {
  try {
    const refreshed = await refreshAresTokensIfNeeded(userId);
    if (refreshed) {
      console.log('ARES tokens are fresh and ready');
    } else {
      console.log('ARES tokens may need attention');
    }
    return refreshed;
  } catch (error) {
    console.error('Error during proactive refresh:', error.message);
    return false;
  }
}

/**
 * Example: Make a custom ARES API call
 */
async function exampleCustomAPICall(userId) {
  try {
    // Example: Get user's balance or any other ARES endpoint
    const response = await callAresAPI(userId, 'balance', {
      method: 'GET',
    });

    console.log('ARES Balance:', response);
    return response;
  } catch (error) {
    console.error('Failed to get ARES balance:', error.message);
    throw error;
  }
}

/**
 * Example: Post data to ARES
 */
async function examplePostToAres(userId, data) {
  try {
    const response = await callAresAPI(userId, 'transactions', {
      method: 'POST',
      body: JSON.stringify(data),
    });

    console.log('ARES Transaction Created:', response);
    return response;
  } catch (error) {
    console.error('Failed to create ARES transaction:', error.message);
    throw error;
  }
}

/**
 * Example: Check if user has valid ARES authentication
 */
async function exampleCheckAuthentication(userId) {
  try {
    const hasToken = await hasValidAresToken(userId);

    if (hasToken) {
      console.log('User has valid ARES authentication');
      return true;
    } else {
      console.log('User needs to authenticate with ARES');
      return false;
    }
  } catch (error) {
    console.error('Error checking ARES authentication:', error.message);
    return false;
  }
}

/**
 * Example: Middleware function for Express routes that require ARES authentication
 */
function requireAresAuth() {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id || req.user?._id;

      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      // Try to get a valid ARES token
      try {
        req.aresToken = await getAresAccessToken(userId);
        next();
      } catch (error) {
        if (error.code === 'ARES_AUTH_REQUIRED') {
          return res.status(401).json({
            error: 'ARES authentication required',
            code: 'ARES_AUTH_REQUIRED',
            redirectUrl: '/auth/ares', // Redirect to ARES OAuth flow
            message: 'Please authenticate with ARES to access this resource',
          });
        }
        throw error; // Re-throw non-auth errors
      }
    } catch (error) {
      logger.error('ARES authentication middleware error:', error);
      res.status(500).json({ error: 'Authentication service error' });
    }
  };
}

/**
 * Example: Background job to maintain fresh ARES tokens
 */
async function aresTokenMaintenanceJob(userIds) {
  logger.info('[aresTokens] Starting token maintenance job', { userCount: userIds.length });

  const results = {
    success: 0,
    failed: 0,
    authRequired: 0,
  };

  for (const userId of userIds) {
    try {
      const refreshed = await refreshAresTokensIfNeeded(userId);
      if (refreshed) {
        results.success++;
      } else {
        results.authRequired++;
      }
    } catch (error) {
      logger.error('[aresTokens] Maintenance job failed for user:', {
        userId,
        error: error.message,
      });
      results.failed++;
    }
  }

  logger.info('[aresTokens] Token maintenance job completed', results);
  return results;
}

/**
 * Example: Manual auto-logout check
 */
async function exampleManualAutoLogout(req, res) {
  try {
    const userId = req.user.id;

    // Check if user should be auto-logged out
    const shouldLogout = await shouldAutoLogout(userId);

    if (shouldLogout) {
      console.log('User should be auto-logged out');
      const success = await autoLogoutUser(req, res, 'Manual check triggered');

      if (success) {
        return { autoLogout: true, message: 'User automatically logged out' };
      }
    }

    return { autoLogout: false, message: 'User has valid ARES tokens' };
  } catch (error) {
    console.error('Error in manual auto-logout check:', error.message);
    return { error: true, message: error.message };
  }
}

/**
 * Example: Setting up auto-logout middleware
 */
function exampleSetupAutoLogoutMiddleware(app) {
  // Option 1: Global auto-logout middleware (recommended)
  // This will automatically log out users with invalid ARES tokens on every request
  app.use(
    aresTokenCheckMiddleware({
      skipRoutes: ['/api/auth/', '/api/oauth/', '/health', '/api/config'],
      logOnly: false, // Set to true for testing/monitoring without actual logout
    }),
  );

  // Option 2: Strict checking for critical routes
  app.use('/api/critical/*', strictAresTokenCheck());

  // Option 3: Lightweight check for specific routes that need ARES
  app.use('/api/ares/*', requireAresTokens());
}

/**
 * Example: Express routes with auto-logout functionality
 */
function exampleAresProtectedRoute(app) {
  // Routes with automatic logout on invalid tokens
  app.get('/api/ares/profile', async (req, res) => {
    try {
      const userId = req.user.id;
      const profile = await getAresUserProfile(userId);
      res.json(profile);
    } catch (error) {
      if (error.code === 'ARES_AUTH_REQUIRED') {
        // This will trigger auto-logout via middleware
        return res.status(401).json({
          error: 'ARES authentication required',
          code: 'ARES_AUTH_REQUIRED',
          redirectUrl: '/auth/ares',
          autoLogout: true,
        });
      }
      res.status(500).json({ error: 'Failed to fetch ARES profile' });
    }
  });

  app.get('/api/ares/balance', async (req, res) => {
    try {
      const userId = req.user.id;
      const balance = await callAresAPI(userId, 'balance');
      res.json(balance);
    } catch (error) {
      if (error.code === 'ARES_AUTH_REQUIRED') {
        return res.status(401).json({
          error: 'ARES authentication required',
          code: 'ARES_AUTH_REQUIRED',
          redirectUrl: '/auth/ares',
          autoLogout: true,
        });
      }
      res.status(500).json({ error: 'Failed to fetch ARES balance' });
    }
  });

  // Manual logout endpoint
  app.post('/api/ares/logout', async (req, res) => {
    try {
      const userId = req.user.id;
      const success = await autoLogoutUser(req, res, 'Manual logout requested');

      if (success) {
        res.json({
          message: 'User logged out successfully',
          autoLogout: true,
          redirectUrl: '/login',
        });
      } else {
        res.status(500).json({ error: 'Failed to logout user' });
      }
    } catch (error) {
      res.status(500).json({ error: 'Failed to logout user' });
    }
  });

  // Manual auto-logout check endpoint (for testing)
  app.post('/api/ares/check-logout', async (req, res) => {
    try {
      const result = await exampleManualAutoLogout(req, res);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Failed to check auto-logout status' });
    }
  });
}

module.exports = {
  exampleGetUserProfile,
  exampleProactiveRefresh,
  exampleCustomAPICall,
  examplePostToAres,
  exampleCheckAuthentication,
  exampleManualAutoLogout,
  exampleSetupAutoLogoutMiddleware,
  requireAresAuth,
  aresTokenMaintenanceJob,
  exampleAresProtectedRoute,
};
