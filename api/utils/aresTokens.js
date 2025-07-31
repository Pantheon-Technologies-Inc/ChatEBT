const { logger } = require('@librechat/data-schemas');
const { refreshAccessToken, decryptV2 } = require('@librechat/api');
const { findToken, createToken, updateToken } = require('~/models');

/**
 * Retrieves a valid ARES access token for the given user.
 * Automatically handles token refresh if the token is expired.
 *
 * @param {string} userId - The user's ID
 * @returns {Promise<string>} The access token
 * @throws {Error} If no token is found or refresh fails
 */
async function getAresAccessToken(userId) {
  try {
    const identifier = 'ares';

    // Get access token from database
    const tokenData = await findToken({
      userId,
      type: 'oauth',
      identifier,
    });

    if (!tokenData) {
      throw new Error('No ARES token found. User needs to re-authenticate with ARES.');
    }

    // Check if token is expired
    const now = new Date();
    const isExpired = tokenData.expiresAt && now >= tokenData.expiresAt;

    if (isExpired) {
      logger.info('[aresTokens] Access token expired, attempting refresh', { userId });

      // Try to refresh the token
      const refreshTokenData = await findToken({
        userId,
        type: 'oauth_refresh',
        identifier: `${identifier}:refresh`,
      });

      if (!refreshTokenData) {
        throw new Error(
          'Token expired and no refresh token available. Please re-authenticate with ARES.',
        );
      }

      try {
        const refresh_token = await decryptV2(refreshTokenData.token);

        const refreshedTokens = await refreshAccessToken(
          {
            userId,
            identifier,
            refresh_token,
            client_url: 'https://oauth.joinares.com/oauth/token',
            token_exchange_method: 'default_post', // Adjust based on ARES requirements
            encrypted_oauth_client_id: process.env.ARES_CLIENT_ID, // This should be encrypted
            encrypted_oauth_client_secret: process.env.ARES_CLIENT_SECRET, // This should be encrypted
          },
          {
            findToken,
            updateToken,
            createToken,
          },
        );

        logger.info('[aresTokens] Token refreshed successfully', { userId });
        return refreshedTokens.access_token;
      } catch (refreshError) {
        logger.error('[aresTokens] Failed to refresh token:', refreshError);
        throw new Error('Failed to refresh ARES token. Please re-authenticate.');
      }
    }

    // Token is valid, decrypt and return
    const decryptedToken = await decryptV2(tokenData.token);
    logger.debug('[aresTokens] Retrieved valid access token', { userId });
    return decryptedToken;
  } catch (error) {
    logger.error('[aresTokens] Error retrieving ARES access token:', error);
    throw error;
  }
}

/**
 * Makes an authenticated API call to ARES.
 *
 * @param {string} userId - The user's ID
 * @param {string} endpoint - The ARES API endpoint (without base URL)
 * @param {Object} options - Fetch options (method, body, headers, etc.)
 * @returns {Promise<Object>} The API response data
 * @throws {Error} If the API call fails
 */
async function callAresAPI(userId, endpoint, options = {}) {
  try {
    const accessToken = await getAresAccessToken(userId);

    const url = `https://oauth.joinares.com/v1/${endpoint.replace(/^\//, '')}`;

    const response = await fetch(url, {
      method: 'GET',
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `ARES API call failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const data = await response.json();
    logger.debug('[aresTokens] ARES API call successful', {
      userId,
      endpoint,
      status: response.status,
    });
    return data;
  } catch (error) {
    logger.error('[aresTokens] ARES API call failed:', { userId, endpoint, error: error.message });
    throw error;
  }
}

/**
 * Gets the current user's ARES profile information.
 *
 * @param {string} userId - The user's ID
 * @returns {Promise<Object>} The user's ARES profile
 */
async function getAresUserProfile(userId) {
  return callAresAPI(userId, 'user');
}

/**
 * Checks if a user has valid ARES tokens.
 *
 * @param {string} userId - The user's ID
 * @returns {Promise<boolean>} True if user has valid ARES tokens
 */
async function hasValidAresToken(userId) {
  try {
    await getAresAccessToken(userId);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Revokes ARES tokens for a user (cleanup).
 *
 * @param {string} userId - The user's ID
 * @returns {Promise<boolean>} True if tokens were successfully revoked
 */
async function revokeAresTokens(userId) {
  try {
    const { deleteTokens } = require('~/models');

    // Delete access token
    await deleteTokens({
      userId,
      identifier: 'ares',
    });

    // Delete refresh token
    await deleteTokens({
      userId,
      identifier: 'ares:refresh',
    });

    logger.info('[aresTokens] ARES tokens revoked successfully', { userId });
    return true;
  } catch (error) {
    logger.error('[aresTokens] Failed to revoke ARES tokens:', error);
    return false;
  }
}

module.exports = {
  getAresAccessToken,
  callAresAPI,
  getAresUserProfile,
  hasValidAresToken,
  revokeAresTokens,
};
