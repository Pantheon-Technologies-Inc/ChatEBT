const { logger } = require('@librechat/data-schemas');
const { refreshAccessToken, decryptV2, encryptV2 } = require('@librechat/api');
const { findToken, createToken, updateToken, deleteTokens } = require('~/models');

/**
 * Production-ready ARES API Client
 * Handles token refresh, API calls, and error handling securely
 */

// In-memory cache to prevent race conditions during token refresh
const refreshPromises = new Map();

/**
 * Perform direct ARES token refresh without using the potentially broken refreshAccessToken function
 * @param {string} userId - The user's MongoDB ID
 * @param {string} identifier - Token identifier 
 * @param {string} refresh_token - Decrypted refresh token
 * @returns {Promise<Object>} Refresh response with access_token and expires_in
 */
async function performDirectAresRefresh(userId, identifier, refresh_token) {
  logger.info('[aresClient] Starting direct ARES token refresh', { userId });

  try {
    const requestBody = {
      grant_type: 'refresh_token',
      refresh_token: refresh_token,
      client_id: process.env.ARES_CLIENT_ID,
      client_secret: process.env.ARES_CLIENT_SECRET,
    };

    logger.info('[aresClient] Making ARES token refresh request', {
      userId,
      url: 'https://oauth.joinares.com/oauth/token',
      hasClientId: !!process.env.ARES_CLIENT_ID,
      hasClientSecret: !!process.env.ARES_CLIENT_SECRET,
      hasRefreshToken: !!refresh_token,
      refreshTokenPrefix: refresh_token?.substring(0, 8) + '...'
    });

    // Make direct call to ARES token refresh endpoint
    const response = await fetch('https://oauth.joinares.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'User-Agent': 'ChatEBT/1.0',
      },
      body: new URLSearchParams(requestBody),
    });

    logger.info('[aresClient] ARES token refresh response received', {
      userId,
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get('content-type'),
      ok: response.ok
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('[aresClient] ARES token refresh failed', {
        userId,
        status: response.status,
        statusText: response.statusText,
        errorBody: errorText,
        headers: Object.fromEntries(response.headers.entries())
      });
      throw new Error(`ARES refresh failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const tokenData = await response.json();
    logger.info('[aresClient] ARES token refresh successful', {
      userId,
      responseKeys: Object.keys(tokenData),
      hasAccessToken: !!tokenData.access_token,
      hasRefreshToken: !!tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      tokenType: tokenData.token_type,
      accessTokenPrefix: tokenData.access_token?.substring(0, 8) + '...'
    });
    
    logger.info('[aresClient] ARES API returned refresh data', {
      userId,
      hasAccessToken: !!tokenData.access_token,
      hasRefreshToken: !!tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      tokenType: tokenData.token_type
    });

    if (!tokenData.access_token) {
      throw new Error('ARES refresh response missing access_token');
    }

    // Encrypt the new access token
    logger.info('[aresClient] Encrypting new access token', { userId });
    const encryptedAccessToken = await encryptV2(tokenData.access_token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (tokenData.expires_in * 1000));

    logger.info('[aresClient] Calculated token expiry', { 
      userId,
      expiresIn: tokenData.expires_in,
      expiresAt: expiresAt.toISOString(),
      minutesFromNow: Math.round((expiresAt - now) / 60000)
    });

    // Delete the old access token specifically 
    logger.info('[aresClient] Deleting old access token', { userId, identifier });
    const mongoose = require('mongoose');
    const Token = mongoose.models.Token;
    const deletedCount = await Token.deleteMany({
      userId: userId,
      type: 'oauth', 
      identifier: identifier
    });
    
    logger.info('[aresClient] Deleted old access token', { 
      userId,
      deletedCount: deletedCount.deletedCount || deletedCount 
    });

    // Create the new access token
    logger.info('[aresClient] Creating new access token', { 
      userId,
      identifier,
      expiresAt: expiresAt.toISOString()
    });
    
    const newAccessToken = await createToken({
      userId,
      type: 'oauth',
      identifier: identifier,
      token: encryptedAccessToken,
      expiresIn: tokenData.expires_in,
    });

    logger.info('[aresClient] Created new access token', { 
      userId,
      tokenId: newAccessToken._id?.toString(),
      expiresAt: newAccessToken.expiresAt?.toISOString(),
      createdAt: newAccessToken.createdAt?.toISOString()
    });

    // If we got a new refresh token, update it too
    if (tokenData.refresh_token) {
      logger.info('[aresClient] Processing refresh token update', { 
        userId,
        hasNewRefreshToken: !!tokenData.refresh_token,
        newRefreshTokenPrefix: tokenData.refresh_token?.substring(0, 8) + '...'
      });
      
      const encryptedRefreshToken = await encryptV2(tokenData.refresh_token);
      
      // Delete old refresh token specifically
      logger.info('[aresClient] Deleting old refresh token', { userId });
      const deletedRefreshCount = await Token.deleteMany({
        userId: userId,
        type: 'oauth_refresh',
        identifier: `${identifier}:refresh`
      });
      logger.info('[aresClient] Deleted old refresh token', { 
        userId,
        deletedCount: deletedRefreshCount.deletedCount || deletedRefreshCount
      });
      
      // Create new refresh token (usually valid for 24 hours)
      const refreshExpiresIn = 24 * 60 * 60; // 24 hours in seconds
      const newRefreshToken = await createToken({
        userId,
        type: 'oauth_refresh',
        identifier: `${identifier}:refresh`,
        token: encryptedRefreshToken,
        expiresIn: refreshExpiresIn,
      });

      logger.info('[aresClient] Created new refresh token', { 
        userId,
        refreshTokenId: newRefreshToken._id?.toString(),
        expiresAt: newRefreshToken.expiresAt?.toISOString()
      });
    } else {
      logger.info('[aresClient] No new refresh token in response - keeping existing one', { userId });
    }

    return {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in,
      token_type: tokenData.token_type,
    };

  } catch (error) {
    logger.error('[aresClient] Direct ARES refresh failed', {
      userId,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

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

    logger.info(`[aresClient] Token lookup completed - userId: ${userId}, tokenFound: ${!!tokenData}`);
    if (tokenData) {
      logger.info(`[aresClient] Token details - id: ${tokenData._id}, type: ${tokenData.type}, identifier: ${tokenData.identifier}, expires: ${tokenData.expiresAt}`);
    } else {
      logger.info(`[aresClient] Token lookup details - searching for userId: ${userId}, type: oauth, identifier: ares`);
    }

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
    const isExpired = tokenData.expiresAt && now >= tokenData.expiresAt;
    const isExpiringSoon = tokenData.expiresAt && fiveMinutesFromNow >= tokenData.expiresAt;
    const needsRefresh = isExpired || isExpiringSoon;

    logger.info(`[aresClient] Token expiry check - expires: ${tokenData.expiresAt}, isExpired: ${isExpired}, isExpiringSoon: ${isExpiringSoon}, needsRefresh: ${needsRefresh}`);

    if (!needsRefresh) {
      // Token is still valid, decrypt and return
      const decryptedToken = await decryptV2(tokenData.token);
      logger.info(`[aresClient] Using existing valid token - expires in ${Math.round((tokenData.expiresAt - now) / 60000)} minutes`);
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

    // Perform direct ARES token refresh instead of using potentially broken refreshAccessToken
    const refreshedTokens = await performDirectAresRefresh(userId, identifier, refresh_token);

    logger.info('[aresClient] Token refreshed successfully', {
      userId,
      expiresIn: refreshedTokens.expires_in,
      hasAccessToken: !!refreshedTokens.access_token,
      hasRefreshToken: !!refreshedTokens.refresh_token
    });

    // Verify the token was actually updated in the database
    // Small delay to ensure database operations are completed
    await new Promise(resolve => setTimeout(resolve, 100));
    
    try {
      const updatedToken = await findToken({
        userId,
        type: 'oauth',
        identifier,
      });

      logger.info('[aresClient] Post-refresh token verification', {
        userId,
        tokenFound: !!updatedToken,
        newExpiry: updatedToken?.expiresAt?.toISOString(),
        tokenId: updatedToken?._id?.toString(),
        createdAt: updatedToken?.createdAt?.toISOString()
      });

      if (!updatedToken) {
        logger.error('[aresClient] CRITICAL: Token missing after refresh!', {
          userId,
          refreshResponse: {
            hasAccessToken: !!refreshedTokens.access_token,
            hasRefreshToken: !!refreshedTokens.refresh_token,
            expiresIn: refreshedTokens.expires_in
          }
        });
      }
    } catch (verificationError) {
      logger.error('[aresClient] Error verifying token after refresh', {
        userId,
        error: verificationError.message
      });
    }

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
    const mongoose = require('mongoose');
    const Token = mongoose.models.Token;

    logger.info('[aresClient] Starting token cleanup', { 
      userId,
      timestamp: new Date().toISOString(),
      tokensToDelete: ['ares', 'ares:refresh']
    });

    const results = await Promise.all([
      Token.deleteMany({ userId: userId, type: 'oauth', identifier: 'ares' }),
      Token.deleteMany({ userId: userId, type: 'oauth_refresh', identifier: 'ares:refresh' })
    ]);

    logger.info('[aresClient] Token cleanup completed', { 
      userId,
      accessTokensDeleted: results[0].deletedCount || results[0],
      refreshTokensDeleted: results[1].deletedCount || results[1],
      totalDeleted: (results[0].deletedCount || results[0]) + (results[1].deletedCount || results[1])
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
  performTokenRefresh,
};