const { logger } = require('@librechat/data-schemas');
const { refreshAccessToken, decryptV2 } = require('@librechat/api');
const { findToken, createToken, updateToken } = require('~/models');

/**
 * Production-ready ARES API Client
 * Handles token refresh, API calls, and error handling securely
 */

// In-memory cache to prevent race conditions during token refresh
const refreshPromises = new Map();

/**
 * Get a valid ARES access token, refreshing if necessary
 * @param {string} userId - The user's MongoDB ID
 * @returns {Promise<string>} Valid access token
 * @throws {Error} If authentication is required
 */
async function getValidAresToken(userId) {
  const identifier = 'ares';

  try {
    logger.info('[aresClient] Starting token retrieval process', { 
      userId, 
      identifier,
      timestamp: new Date().toISOString()
    });

    // Get current access token
    const tokenData = await findToken({
      userId,
      type: 'oauth',
      identifier,
    });

    logger.info('[aresClient] Token lookup completed', { 
      userId, 
      tokenFound: !!tokenData,
      tokenId: tokenData?._id?.toString(),
      tokenType: tokenData?.type,
      tokenIdentifier: tokenData?.identifier,
      hasExpiresAt: !!tokenData?.expiresAt,
      expiresAt: tokenData?.expiresAt?.toISOString(),
      createdAt: tokenData?.createdAt?.toISOString(),
      updatedAt: tokenData?.updatedAt?.toISOString()
    });

    if (!tokenData) {
      const error = new Error('ARES authentication required. Please sign in with ARES.');
      error.code = 'ARES_AUTH_REQUIRED';
      logger.info('[aresClient] No ARES token found - user needs to authenticate', { 
        userId,
        searchCriteria: { userId, type: 'oauth', identifier }
      });
      throw error;
    }

    // Check if token is expired or expiring soon (5 minute buffer)
    const now = new Date();
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);
    const needsRefresh = tokenData.expiresAt && fiveMinutesFromNow >= tokenData.expiresAt;

    if (!needsRefresh) {
      // Token is still valid, decrypt and return
      const decryptedToken = await decryptV2(tokenData.token);
      logger.debug('[aresClient] Using existing valid token', { 
        userId, 
        expiresAt: tokenData.expiresAt 
      });
      return decryptedToken;
    }

    // Token needs refresh - check for existing refresh operation
    if (refreshPromises.has(userId)) {
      logger.info('[aresClient] Waiting for existing refresh operation', { userId });
      return await refreshPromises.get(userId);
    }

    // Start new refresh operation
    logger.info('[aresClient] Token expired/expiring soon, refreshing', {
      userId,
      expiresAt: tokenData.expiresAt,
      isExpired: now >= tokenData.expiresAt
    });

    const refreshPromise = performTokenRefresh(userId, identifier);
    refreshPromises.set(userId, refreshPromise);

    try {
      const refreshedToken = await refreshPromise;
      refreshPromises.delete(userId);
      return refreshedToken;
    } catch (error) {
      refreshPromises.delete(userId);
      throw error;
    }

  } catch (error) {
    logger.error('[aresClient] Error getting valid ARES token', {
      userId,
      error: error.message,
      code: error.code
    });
    throw error;
  }
}

/**
 * Perform token refresh using refresh token
 * @param {string} userId - The user's MongoDB ID
 * @param {string} identifier - Token identifier
 * @returns {Promise<string>} New access token
 */
async function performTokenRefresh(userId, identifier) {
  try {
    logger.info('[aresClient] Starting token refresh process', { 
      userId, 
      identifier,
      timestamp: new Date().toISOString()
    });

    // Get refresh token
    const refreshTokenData = await findToken({
      userId,
      type: 'oauth_refresh',
      identifier: `${identifier}:refresh`,
    });

    logger.info('[aresClient] Refresh token lookup completed', { 
      userId, 
      refreshTokenFound: !!refreshTokenData,
      refreshTokenId: refreshTokenData?._id?.toString(),
      refreshTokenType: refreshTokenData?.type,
      refreshTokenIdentifier: refreshTokenData?.identifier,
      refreshTokenExpiresAt: refreshTokenData?.expiresAt?.toISOString(),
      searchCriteria: { userId, type: 'oauth_refresh', identifier: `${identifier}:refresh` }
    });

    if (!refreshTokenData) {
      await cleanupTokens(userId);
      const error = new Error('ARES authentication required. Please sign in with ARES.');
      error.code = 'ARES_AUTH_REQUIRED';
      logger.warn('[aresClient] No refresh token found - cleaning up and requiring auth', { 
        userId,
        searchCriteria: { userId, type: 'oauth_refresh', identifier: `${identifier}:refresh` }
      });
      throw error;
    }

    // Check if refresh token is expired
    const now = new Date();
    if (refreshTokenData.expiresAt && now >= refreshTokenData.expiresAt) {
      await cleanupTokens(userId);
      const error = new Error('ARES authentication required. Please sign in with ARES.');
      error.code = 'ARES_AUTH_REQUIRED';
      logger.warn('[aresClient] Refresh token expired', { 
        userId, 
        refreshExpiresAt: refreshTokenData.expiresAt 
      });
      throw error;
    }

    // Decrypt refresh token
    const refresh_token = await decryptV2(refreshTokenData.token);

    // Refresh the access token
    const refreshedTokens = await refreshAccessToken(
      {
        userId,
        identifier,
        refresh_token,
        client_url: 'https://oauth.joinares.com/oauth/token',
        token_exchange_method: 'default_post',
        encrypted_oauth_client_id: process.env.ARES_CLIENT_ID,
        encrypted_oauth_client_secret: process.env.ARES_CLIENT_SECRET,
      },
      {
        findToken,
        updateToken,
        createToken,
      }
    );

    logger.info('[aresClient] Token refreshed successfully', {
      userId,
      expiresIn: refreshedTokens.expires_in
    });

    return refreshedTokens.access_token;

  } catch (error) {
    logger.error('[aresClient] Token refresh failed', {
      userId,
      error: error.message,
      stack: error.stack
    });

    // Clean up failed tokens
    await cleanupTokens(userId);
    
    const authError = new Error('ARES authentication required. Please sign in with ARES.');
    authError.code = 'ARES_AUTH_REQUIRED';
    throw authError;
  }
}

/**
 * Make authenticated API call to ARES
 * @param {string} userId - The user's MongoDB ID
 * @param {string} endpoint - ARES API endpoint
 * @param {Object} options - Fetch options
 * @returns {Promise<Object>} API response data
 */
async function callAresAPI(userId, endpoint, options = {}) {
  if (!userId) {
    throw new Error('User ID is required for ARES API calls');
  }

  if (!endpoint) {
    throw new Error('Endpoint is required for ARES API calls');
  }

  let attempt = 0;
  const maxAttempts = 2;

  while (attempt < maxAttempts) {
    try {
      const accessToken = await getValidAresToken(userId);
      const url = `https://oauth.joinares.com/v1/${endpoint.replace(/^\//, '')}`;

      const response = await fetch(url, {
        method: 'GET',
        ...options,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'ChatEBT/1.0',
          ...options.headers,
        },
      });

      // Handle 401 - token might be invalid, try refresh once
      if (response.status === 401 && attempt === 0) {
        logger.warn('[aresClient] Received 401, attempting token refresh', { 
          userId, 
          endpoint, 
          attempt 
        });
        
        // Force token refresh by clearing cache and incrementing attempt
        refreshPromises.delete(userId);
        attempt++;
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('[aresClient] ARES API call failed', {
          userId,
          endpoint,
          status: response.status,
          statusText: response.statusText,
          error: errorText
        });

        if (response.status === 401) {
          await cleanupTokens(userId);
          const error = new Error('ARES authentication required. Please sign in with ARES.');
          error.code = 'ARES_AUTH_REQUIRED';
          throw error;
        }

        throw new Error(`ARES API call failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      logger.debug('[aresClient] ARES API call successful', {
        userId,
        endpoint,
        status: response.status,
        attempt
      });

      return data;

    } catch (error) {
      if (error.code === 'ARES_AUTH_REQUIRED' || attempt >= maxAttempts - 1) {
        throw error;
      }

      logger.warn('[aresClient] API call attempt failed, retrying', {
        userId,
        endpoint,
        attempt,
        error: error.message
      });

      attempt++;
    }
  }

  throw new Error('Maximum API call attempts reached');
}

/**
 * Get ARES user profile
 * @param {string} userId - The user's MongoDB ID
 * @returns {Promise<Object>} User profile data
 */
async function getAresUserProfile(userId) {
  return await callAresAPI(userId, 'user');
}

/**
 * Clean up ARES tokens for a user
 * @param {string} userId - The user's MongoDB ID
 */
async function cleanupTokens(userId) {
  try {
    const { deleteTokens } = require('~/models');

    logger.info('[aresClient] Starting token cleanup', { 
      userId,
      timestamp: new Date().toISOString(),
      tokensToDelete: ['ares', 'ares:refresh']
    });

    const results = await Promise.all([
      deleteTokens({ userId, identifier: 'ares' }),
      deleteTokens({ userId, identifier: 'ares:refresh' })
    ]);

    logger.info('[aresClient] Token cleanup completed', { 
      userId,
      accessTokensDeleted: results[0],
      refreshTokensDeleted: results[1],
      totalDeleted: results[0] + results[1]
    });

  } catch (error) {
    logger.error('[aresClient] Error cleaning up tokens', {
      userId,
      error: error.message,
      stack: error.stack
    });
  }
}

/**
 * Check if user has valid ARES tokens
 * @param {string} userId - The user's MongoDB ID
 * @returns {Promise<boolean>} True if user has valid tokens
 */
async function hasValidAresTokens(userId) {
  try {
    await getValidAresToken(userId);
    return true;
  } catch (error) {
    return false;
  }
}

module.exports = {
  getValidAresToken,
  callAresAPI,
  getAresUserProfile,
  cleanupTokens,
  hasValidAresTokens,
};