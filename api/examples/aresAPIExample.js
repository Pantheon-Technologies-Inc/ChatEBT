/**
 * Example usage of ARES token utilities for making authenticated API calls.
 * This file demonstrates how to use the ARES token system to access protected resources.
 */

const {
  getAresAccessToken,
  callAresAPI,
  getAresUserProfile,
  hasValidAresToken,
  revokeAresTokens,
} = require('../utils/aresTokens');
const { logger } = require('@librechat/data-schemas');

/**
 * Example: Get user's ARES profile
 */
async function exampleGetUserProfile(userId) {
  try {
    const profile = await getAresUserProfile(userId);
    console.log('ARES User Profile:', profile);
    return profile;
  } catch (error) {
    console.error('Failed to get ARES profile:', error.message);
    throw error;
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
function requireAresAuth(req, res, next) {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id || req.user?._id;

      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const hasValidToken = await hasValidAresToken(userId);

      if (!hasValidToken) {
        return res.status(401).json({
          error: 'ARES authentication required',
          redirectUrl: '/auth/ares', // Redirect to ARES OAuth flow
        });
      }

      // Add ARES token to request for use in route handlers
      req.aresToken = await getAresAccessToken(userId);
      next();
    } catch (error) {
      logger.error('ARES authentication middleware error:', error);
      res.status(500).json({ error: 'Authentication service error' });
    }
  };
}

/**
 * Example: Express route that uses ARES authentication
 */
function exampleAresProtectedRoute(app) {
  app.get('/api/ares/profile', requireAresAuth, async (req, res) => {
    try {
      const userId = req.user.id;
      const profile = await getAresUserProfile(userId);
      res.json(profile);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch ARES profile' });
    }
  });

  app.get('/api/ares/balance', requireAresAuth, async (req, res) => {
    try {
      const userId = req.user.id;
      const balance = await callAresAPI(userId, 'balance');
      res.json(balance);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch ARES balance' });
    }
  });

  app.post('/api/ares/logout', async (req, res) => {
    try {
      const userId = req.user.id;
      await revokeAresTokens(userId);
      res.json({ message: 'ARES tokens revoked successfully' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to revoke ARES tokens' });
    }
  });
}

module.exports = {
  exampleGetUserProfile,
  exampleCustomAPICall,
  examplePostToAres,
  exampleCheckAuthentication,
  requireAresAuth,
  exampleAresProtectedRoute,
};
