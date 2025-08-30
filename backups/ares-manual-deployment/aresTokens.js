const { logger } = require('@librechat/data-schemas');
const { refreshAccessToken, decryptV2 } = require('@librechat/api');
const { findToken, createToken, updateToken } = require('~/models');
const { logoutUser } = require('~/server/services/AuthService');

// Store ongoing refresh operations to prevent race conditions
const refreshOperations = new Map();

/**
 * Retrieves a valid ARES access token for the given user.
 * Aggressively handles token refresh and forces re-authentication on failure.
 * Prevents race conditions by ensuring only one refresh operation per user.
 *
 * @param {string} userId - The user's ID
 * @param {boolean} forceRefresh - Force refresh even if token seems valid
 * @returns {Promise<string>} The access token
 * @throws {Error} If no token is found or refresh fails (requires re-auth)
 */
async function getAresAccessToken(userId, forceRefresh = false) {
  try {
    const identifier = 'ares';

    // Get access token from database
    const tokenData = await findToken({
      userId,
      type: 'oauth',
      identifier,
    });

    if (!tokenData) {
      logger.warn('[aresTokens] No ARES access token found in database', {
        userId,
        forceRefresh,
        message: 'This is what causes "No ARES token found" error',
      });
      const error = new Error('ARES_AUTH_REQUIRED: No ARES token found. User must authenticate.');
      error.code = 'ARES_AUTH_REQUIRED';
      throw error;
    }

    // Check if token is expired or will expire soon (5 minutes buffer)
    const now = new Date();
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);
    const isExpired = tokenData.expiresAt && now >= tokenData.expiresAt;
    const isExpiringSoon = tokenData.expiresAt && fiveMinutesFromNow >= tokenData.expiresAt;

    if (isExpired || isExpiringSoon || forceRefresh) {
      // Check if there's already a refresh operation in progress for this user
      if (refreshOperations.has(userId)) {
        logger.info('[aresTokens] Waiting for existing refresh operation', { userId });
        try {
          // Wait for the existing refresh operation to complete
          const refreshedToken = await refreshOperations.get(userId);
          return refreshedToken;
        } catch (error) {
          // If the existing refresh failed, we'll proceed with our own refresh
          logger.warn('[aresTokens] Existing refresh operation failed, retrying', { userId });
          refreshOperations.delete(userId);
        }
      }

      logger.info('[aresTokens] Token expired/expiring soon, attempting refresh', {
        userId,
        isExpired,
        isExpiringSoon,
        forceRefresh,
        expiresAt: tokenData.expiresAt,
      });

      // Create a promise for this refresh operation
      const refreshPromise = performTokenRefresh(userId, identifier);
      refreshOperations.set(userId, refreshPromise);

      try {
        const refreshedToken = await refreshPromise;
        refreshOperations.delete(userId);
        return refreshedToken;
      } catch (error) {
        refreshOperations.delete(userId);
        throw error;
      }
    }

    // Token is valid, decrypt and return
    const decryptedToken = await decryptV2(tokenData.token);
    logger.debug('[aresTokens] Retrieved valid access token', {
      userId,
      expiresAt: tokenData.expiresAt,
    });
    return decryptedToken;
  } catch (error) {
    logger.error('[aresTokens] Error retrieving ARES access token:', error);
    throw error;
  }
}

/**
 * Performs the actual token refresh operation
 * @param {string} userId - The user's ID
 * @param {string} identifier - The token identifier
 * @returns {Promise<string>} The refreshed access token
 */
async function performTokenRefresh(userId, identifier) {
  try {
    logger.info('[aresTokens] Starting token refresh attempt', {
      userId,
      identifier,
      timestamp: new Date().toISOString(),
    });

    const now = new Date();

    const refreshTokenData = await findToken({
      userId,
      type: 'oauth_refresh',
      identifier: `${identifier}:refresh`,
    });

    if (!refreshTokenData) {
      logger.warn('[aresTokens] No refresh token found - will delete all tokens', {
        userId,
        identifier,
        message: 'This will trigger token deletion and logout',
      });
      // Clean up invalid access token
      await revokeAresTokens(userId);
      const error = new Error(
        'ARES_AUTH_REQUIRED: Refresh token not available. User must re-authenticate.',
      );
      error.code = 'ARES_AUTH_REQUIRED';
      throw error;
    }

    // Check if refresh token is also expired
    const refreshExpired = refreshTokenData.expiresAt && now >= refreshTokenData.expiresAt;
    if (refreshExpired) {
      logger.warn('[aresTokens] Refresh token expired - will delete all tokens', {
        userId,
        refreshTokenExpiry: refreshTokenData.expiresAt,
        currentTime: now,
        message: 'This will trigger token deletion and logout',
      });
      // Clean up expired tokens
      await revokeAresTokens(userId);
      const error = new Error(
        'ARES_AUTH_REQUIRED: Refresh token expired. User must re-authenticate.',
      );
      error.code = 'ARES_AUTH_REQUIRED';
      throw error;
    }

    const refresh_token = await decryptV2(refreshTokenData.token);

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
      },
    );

    logger.info('[aresTokens] Token refreshed successfully', {
      userId,
      newExpiry: refreshedTokens.expires_in,
    });
    return refreshedTokens.access_token;
  } catch (refreshError) {
    logger.error('[aresTokens] Token refresh failed - will delete all tokens', {
      userId,
      error: refreshError.message,
      errorCode: refreshError.code,
      errorStack: refreshError.stack?.split('\n').slice(0, 3),
      message: 'This refresh failure will trigger complete token deletion',
    });
    // Clean up failed tokens
    await revokeAresTokens(userId);
    const error = new Error('ARES_AUTH_REQUIRED: Token refresh failed. User must re-authenticate.');
    error.code = 'ARES_AUTH_REQUIRED';
    throw error;
  }
}

/**
 * Makes an authenticated API call to ARES with automatic retry and token refresh.
 *
 * @param {string} userId - The user's ID
 * @param {string} endpoint - The ARES API endpoint (without base URL)
 * @param {Object} options - Fetch options (method, body, headers, etc.)
 * @param {number} retryCount - Internal retry counter
 * @returns {Promise<Object>} The API response data
 * @throws {Error} If the API call fails or authentication is required
 */
async function callAresAPI(userId, endpoint, options = {}, retryCount = 0) {
  const maxRetries = 1; // Only retry once for token refresh

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

    // Handle 401 Unauthorized - token might be invalid
    if (response.status === 401) {
      logger.warn('[aresTokens] Received 401 from ARES API', { userId, endpoint, retryCount });

      // Only attempt refresh if this is the first attempt
      if (retryCount < maxRetries) {
        try {
          // Force refresh the token and retry
          await getAresAccessToken(userId, true);
          return await callAresAPI(userId, endpoint, options, retryCount + 1);
        } catch (refreshError) {
          if (refreshError.code === 'ARES_AUTH_REQUIRED') {
            logger.warn(
              '[aresTokens] Token refresh failed with ARES_AUTH_REQUIRED - authentication expired',
              { userId, endpoint },
            );
            // Re-throw as auth required error without retry
            throw refreshError;
          }
          throw new Error(`Token refresh failed during API call: ${refreshError.message}`);
        }
      } else {
        // Too many retries - treat as authentication required
        logger.error(
          '[aresTokens] Max retries reached for 401 errors - treating as auth required',
          { userId, endpoint, retryCount },
        );
        const error = new Error('ARES_AUTH_REQUIRED: Maximum authentication retries exceeded.');
        error.code = 'ARES_AUTH_REQUIRED';
        throw error;
      }
    }

    if (!response.ok) {
      const errorText = await response.text();

      // Handle specific ARES error responses
      if (response.status === 401) {
        const error = new Error(
          'ARES_AUTH_REQUIRED: Authentication failed. User must re-authenticate.',
        );
        error.code = 'ARES_AUTH_REQUIRED';
        throw error;
      }

      throw new Error(
        `ARES API call failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const data = await response.json();
    logger.debug('[aresTokens] ARES API call successful', {
      userId,
      endpoint,
      status: response.status,
      retryCount,
    });
    return data;
  } catch (error) {
    // Pass through auth required errors
    if (error.code === 'ARES_AUTH_REQUIRED') {
      throw error;
    }

    logger.error('[aresTokens] ARES API call failed:', {
      userId,
      endpoint,
      error: error.message,
      retryCount,
    });
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
    if (error.code === 'ARES_AUTH_REQUIRED') {
      return false;
    }
    logger.error('[aresTokens] Error checking token validity:', error);
    return false;
  }
}

/**
 * Proactively refreshes ARES tokens if they're expiring soon.
 * Call this periodically to maintain fresh tokens.
 *
 * @param {string} userId - The user's ID
 * @returns {Promise<boolean>} True if refresh was successful or not needed
 */
async function refreshAresTokensIfNeeded(userId) {
  try {
    const identifier = 'ares';

    // Get current token info
    const tokenData = await findToken({
      userId,
      type: 'oauth',
      identifier,
    });

    if (!tokenData) {
      logger.debug('[aresTokens] No token found for proactive refresh', { userId });
      return false;
    }

    // Check if token expires within 15 minutes (increased buffer for active users)
    const now = new Date();
    const fifteenMinutesFromNow = new Date(now.getTime() + 15 * 60 * 1000);
    const needsRefresh = tokenData.expiresAt && fifteenMinutesFromNow >= tokenData.expiresAt;

    if (needsRefresh) {
      logger.info('[aresTokens] Proactively refreshing token', {
        userId,
        expiresAt: tokenData.expiresAt,
      });
      await getAresAccessToken(userId, true); // Force refresh
      return true;
    }

    logger.debug('[aresTokens] Token refresh not needed (not expiring within 15 minutes)', {
      userId,
      expiresAt: tokenData.expiresAt,
    });
    return true;
  } catch (error) {
    logger.error('[aresTokens] Error during proactive token refresh:', error);
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
    // DEBUG: Log who is deleting tokens and why
    const stack = new Error().stack;
    const callerInfo = stack.split('\n')[2]?.trim() || 'unknown caller';

    logger.warn('[aresTokens] DELETING ARES TOKENS - DEBUG INFO', {
      userId,
      caller: callerInfo,
      timestamp: new Date().toISOString(),
      stackTrace: stack
        .split('\n')
        .slice(1, 5)
        .map((line) => line.trim()),
    });

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

    logger.warn('[aresTokens] ARES tokens revoked successfully', { userId, caller: callerInfo });
    return true;
  } catch (error) {
    logger.error('[aresTokens] Failed to revoke ARES tokens:', error);
    return false;
  }
}

/**
 * Automatically logs out a user when ARES tokens are invalid/expired.
 * This forces a complete logout from the application, not just ARES.
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} reason - Reason for auto-logout (for logging)
 * @returns {Promise<boolean>} True if logout was successful
 */
async function autoLogoutUser(req, res, reason = 'ARES token invalid') {
  try {
    const userId = req.user?.id || req.user?._id;

    if (!userId) {
      logger.warn('[aresTokens] Cannot auto-logout: no user in request');
      return false;
    }

    logger.info('[aresTokens] Auto-logging out user due to ARES token issues', {
      userId,
      reason,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
    });

    // Revoke ARES tokens first
    await revokeAresTokens(userId);

    // Extract refresh token from cookies for proper logout
    const cookies = require('cookie');
    const refreshToken = req.headers.cookie ? cookies.parse(req.headers.cookie).refreshToken : null;

    // Use existing logout functionality
    const logoutResult = await logoutUser(req, refreshToken);

    // Clear cookies
    res.clearCookie('refreshToken');
    res.clearCookie('token_provider');

    if (logoutResult.status === 200) {
      logger.info('[aresTokens] User auto-logout completed successfully', { userId, reason });
      return true;
    } else {
      logger.error('[aresTokens] Auto-logout failed:', logoutResult);
      return false;
    }
  } catch (error) {
    logger.error('[aresTokens] Error during auto-logout:', error);
    return false;
  }
}

/**
 * Updates user's last activity timestamp using a simple activity token
 *
 * @param {string} userId - The user's ID
 * @returns {Promise<void>}
 */
async function updateUserActivity(userId) {
  try {
    const { updateUser } = require('~/models');
    const newActivity = new Date();

    logger.info('[aresTokens] Updating user activity timestamp', {
      userId,
      newActivity: newActivity.toISOString(),
      message: 'This should keep user marked as active',
    });

    await updateUser(
      { _id: userId },
      {
        lastActivity: newActivity,
        $unset: { inactiveLogout: 1 }, // Remove any previous inactive logout flag
      },
    );
    logger.info('[aresTokens] User activity timestamp updated successfully', {
      userId,
      timestamp: newActivity.toISOString(),
    });
  } catch (error) {
    // Fallback to token-based approach if user update fails
    try {
      await createToken({
        userId,
        type: 'activity',
        identifier: 'last_active',
        token: Date.now().toString(), // Store timestamp as token
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      });
      logger.debug('[aresTokens] Fallback: Updated user activity timestamp via token', { userId });
    } catch (tokenError) {
      // Try to update existing token if create fails
      try {
        await updateToken(
          { userId, type: 'activity', identifier: 'last_active' },
          {
            token: Date.now().toString(),
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        );
        logger.debug('[aresTokens] Fallback: Updated existing user activity timestamp', { userId });
      } catch (updateError) {
        logger.error('[aresTokens] Error updating user activity:', updateError);
      }
    }
  }
}

/**
 * Checks if a user has been inactive for more than 30 days
 *
 * @param {string} userId - The user's ID
 * @returns {Promise<boolean>} True if user has been inactive for 30+ days
 */
async function isUserInactive(userId) {
  try {
    const { findUser } = require('~/models');
    const user = await findUser({ _id: userId });

    if (!user) {
      logger.warn('[aresTokens] User not found - marking as inactive', { userId });
      return true; // No user found, consider inactive
    }

    // Check if user has lastActivity field, fallback to createdAt if not
    const lastActivity = user.lastActivity || user.createdAt;
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    if (!lastActivity) {
      logger.warn('[aresTokens] User has no activity data - marking as inactive', { userId });
      return true;
    }

    const isInactive = lastActivity < thirtyDaysAgo;
    const daysSinceActivity = Math.floor(
      (now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24),
    );

    // DEBUG: Always log activity check details
    logger.info('[aresTokens] User activity check details', {
      userId,
      lastActivity: lastActivity.toISOString(),
      createdAt: user.createdAt?.toISOString(),
      thirtyDaysAgo: thirtyDaysAgo.toISOString(),
      daysSinceActivity,
      isInactive,
      hasLastActivity: !!user.lastActivity,
      usingCreatedAtFallback: !user.lastActivity && !!user.createdAt,
    });

    return isInactive;
  } catch (error) {
    logger.error('[aresTokens] Error checking user inactivity:', error);
    return false; // On error, assume user is active to avoid unexpected logouts
  }
}

/**
 * Checks if a user should be automatically logged out due to ARES token issues.
 * This is called by middleware to enforce logout when tokens are invalid.
 * Only logs out users who have been inactive for 30+ days.
 *
 * @param {string} userId - The user's ID
 * @returns {Promise<boolean>} True if user should be logged out
 */
async function shouldAutoLogout(userId) {
  try {
    // Update user activity since they're making a request
    await updateUserActivity(userId);

    // Check if user has any ARES tokens at all
    const hasAccessToken = await findToken({
      userId,
      type: 'oauth',
      identifier: 'ares',
    });

    const hasRefreshToken = await findToken({
      userId,
      type: 'oauth_refresh',
      identifier: 'ares:refresh',
    });

    // If user has no ARES tokens at all, they need to be logged out to break the loop
    // The frontend will handle redirecting them to ARES auth after logout
    if (!hasAccessToken && !hasRefreshToken) {
      logger.info('[aresTokens] User has no ARES tokens - forcing logout to break request loop', {
        userId,
      });
      return true;
    }

    // If tokens exist but are expired and can't be refreshed, logout to force re-auth
    if (hasAccessToken) {
      const now = new Date();
      const isExpired = hasAccessToken.expiresAt && now >= hasAccessToken.expiresAt;

      if (isExpired && !hasRefreshToken) {
        logger.info(
          '[aresTokens] User has expired ARES token with no refresh - should auto-logout',
          { userId },
        );
        return true;
      }

      // Check if refresh token is also expired
      if (isExpired && hasRefreshToken) {
        const refreshExpired = hasRefreshToken.expiresAt && now >= hasRefreshToken.expiresAt;
        if (refreshExpired) {
          logger.info(
            '[aresTokens] User has expired ARES tokens (both access and refresh) - should auto-logout',
            { userId },
          );
          return true;
        }
      }
    }

    return false;
  } catch (error) {
    logger.error('[aresTokens] Error checking auto-logout conditions:', error);
    // On error, be conservative and don't logout to avoid disrupting users
    return false;
  }
}

module.exports = {
  getAresAccessToken,
  callAresAPI,
  getAresUserProfile,
  hasValidAresToken,
  refreshAresTokensIfNeeded,
  revokeAresTokens,
  autoLogoutUser,
  shouldAutoLogout,
  updateUserActivity,
  isUserInactive,
};
