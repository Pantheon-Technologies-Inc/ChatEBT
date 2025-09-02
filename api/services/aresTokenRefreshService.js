const { logger } = require('@librechat/data-schemas');
const { getValidAresToken, cleanupTokens } = require('~/utils/aresClient');
const { findToken } = require('~/models');

/**
 * Background service to proactively refresh ARES tokens for active users
 * Prevents tokens from expiring when users are inactive but want to maintain their session
 */

class AresTokenRefreshService {
  constructor() {
    this.intervalId = null;
    this.isRunning = false;
    this.refreshInterval = 15 * 60 * 1000; // 15 minutes
    this.userActivityThreshold = 30 * 24 * 60 * 60 * 1000; // 30 days
  }

  /**
   * Start the background refresh service
   */
  start() {
    if (this.isRunning) {
      logger.warn('[aresTokenRefresh] Service already running');
      return;
    }

    logger.info('[aresTokenRefresh] Starting background token refresh service', {
      refreshInterval: `${this.refreshInterval / 60000} minutes`,
      userActivityThreshold: `${this.userActivityThreshold / (24 * 60 * 60 * 1000)} days`
    });

    this.isRunning = true;
    
    // Run immediately on start
    this.runRefreshCycle().catch(error => {
      logger.error('[aresTokenRefresh] Error in initial refresh cycle', { error: error.message });
    });

    // Then run on interval
    this.intervalId = setInterval(() => {
      this.runRefreshCycle().catch(error => {
        logger.error('[aresTokenRefresh] Error in refresh cycle', { error: error.message });
      });
    }, this.refreshInterval);
  }

  /**
   * Stop the background refresh service
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    logger.info('[aresTokenRefresh] Stopping background token refresh service');
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    this.isRunning = false;
  }

  /**
   * Run a single refresh cycle - check all users and refresh tokens as needed
   */
  async runRefreshCycle() {
    const startTime = Date.now();
    logger.info('[aresTokenRefresh] Starting refresh cycle');

    try {
      // Find all ARES access tokens that need refresh (expiring within 5 minutes)
      const now = new Date();
      const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);
      const thirtyDaysAgo = new Date(now.getTime() - this.userActivityThreshold);

      const tokensNeedingRefresh = await this.findTokensNeedingRefresh(fiveMinutesFromNow, thirtyDaysAgo);
      
      logger.info('[aresTokenRefresh] Token search completed', { 
        count: tokensNeedingRefresh.length,
        searchCriteria: {
          type: 'oauth',
          identifier: 'ares',
          expiresAt: `<= ${fiveMinutesFromNow.toISOString()}`,
          createdAt: `>= ${thirtyDaysAgo.toISOString()}`
        }
      });

      if (tokensNeedingRefresh.length > 0) {
        logger.info('[aresTokenRefresh] Tokens found for refresh:', 
          tokensNeedingRefresh.map(token => ({
            userId: token.userId,
            tokenId: token._id,
            expiresAt: token.expiresAt,
            createdAt: token.createdAt,
            minutesUntilExpiry: Math.round((token.expiresAt - now) / 60000)
          }))
        );
      }

      if (tokensNeedingRefresh.length === 0) {
        logger.info('[aresTokenRefresh] No tokens need refresh');
        return;
      }

      // Process each token
      const results = {
        successful: 0,
        failed: 0,
        skipped: 0
      };

      for (const token of tokensNeedingRefresh) {
        try {
          logger.info('[aresTokenRefresh] Processing token refresh', {
            userId: token.userId,
            tokenId: token._id,
            currentExpiry: token.expiresAt,
            minutesUntilExpiry: Math.round((token.expiresAt - now) / 60000)
          });

          const result = await this.refreshUserToken(token.userId.toString(), token);
          
          logger.info('[aresTokenRefresh] Token refresh result', {
            userId: token.userId,
            success: result.success,
            skipped: result.skipped,
            reason: result.reason
          });

          if (result.success) {
            results.successful++;
          } else if (result.skipped) {
            results.skipped++;
          } else {
            results.failed++;
          }
        } catch (error) {
          logger.error('[aresTokenRefresh] Error refreshing token for user', {
            userId: token.userId,
            tokenId: token._id,
            error: error.message,
            stack: error.stack
          });
          results.failed++;
        }

        // Small delay between refreshes to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const duration = Date.now() - startTime;
      // Clean up expired tokens that are older than 1 hour (manual cleanup since we removed TTL)
      await this.cleanupExpiredTokens();

      logger.info('[aresTokenRefresh] Refresh cycle completed', {
        duration: `${duration}ms`,
        successful: results.successful,
        failed: results.failed,
        skipped: results.skipped,
        total: tokensNeedingRefresh.length
      });

    } catch (error) {
      logger.error('[aresTokenRefresh] Error in refresh cycle', {
        error: error.message,
        stack: error.stack
      });
    }
  }

  /**
   * Find ARES tokens that need refresh based on expiry time and user activity
   */
  async findTokensNeedingRefresh(expiryThreshold, activityThreshold) {
    try {
      const mongoose = require('mongoose');
      if (!mongoose.models.Token) {
        logger.error('[aresTokenRefresh] Token model not available');
        return [];
      }
      const Token = mongoose.models.Token;

      // Find ARES access tokens that expire soon and belong to recently active users
      logger.info('[aresTokenRefresh] Executing token search query', {
        expiryThreshold: expiryThreshold.toISOString(),
        activityThreshold: activityThreshold.toISOString()
      });

      const tokens = await Token.find({
        type: 'oauth',
        identifier: 'ares',
        expiresAt: { $lte: expiryThreshold }, // Expires within 5 minutes
        createdAt: { $gte: activityThreshold } // Token created within 30 days (indicates recent activity)
      }).lean();

      logger.info('[aresTokenRefresh] Database query completed', {
        foundCount: tokens.length,
        tokens: tokens.map(t => ({
          userId: t.userId,
          expiresAt: t.expiresAt,
          createdAt: t.createdAt
        }))
      });

      return tokens;
    } catch (error) {
      logger.error('[aresTokenRefresh] Error finding tokens needing refresh', {
        error: error.message
      });
      return [];
    }
  }

  /**
   * Refresh token for a specific user
   */
  async refreshUserToken(userId, accessToken) {
    try {
      logger.info('[aresTokenRefresh] Attempting to refresh token', {
        userId,
        currentExpiry: accessToken.expiresAt,
        tokenId: accessToken._id
      });

      // Check if user has a valid refresh token
      const refreshToken = await findToken({
        userId,
        type: 'oauth_refresh',
        identifier: 'ares:refresh'
      });

      if (!refreshToken) {
        logger.warn('[aresTokenRefresh] No refresh token found - skipping user', { userId });
        return { success: false, skipped: true, reason: 'no_refresh_token' };
      }

      // Check if refresh token is expired
      const now = new Date();
      if (refreshToken.expiresAt && now >= refreshToken.expiresAt) {
        logger.warn('[aresTokenRefresh] Refresh token expired - cleaning up', {
          userId,
          refreshTokenExpiry: refreshToken.expiresAt
        });
        
        await cleanupTokens(userId);
        return { success: false, skipped: true, reason: 'refresh_token_expired' };
      }

      // Use the existing getValidAresToken function which handles refresh logic
      const newAccessToken = await getValidAresToken(userId);
      
      if (newAccessToken) {
        logger.info('[aresTokenRefresh] Token refreshed successfully', {
          userId,
          previousExpiry: accessToken.expiresAt
        });
        return { success: true };
      } else {
        logger.warn('[aresTokenRefresh] Token refresh returned no token', { userId });
        return { success: false, reason: 'no_token_returned' };
      }

    } catch (error) {
      if (error.code === 'ARES_AUTH_REQUIRED') {
        logger.info('[aresTokenRefresh] User requires re-authentication - skipping', {
          userId,
          reason: error.message
        });
        return { success: false, skipped: true, reason: 'auth_required' };
      }

      logger.error('[aresTokenRefresh] Error refreshing token for user', {
        userId,
        error: error.message
      });
      return { success: false, reason: error.message };
    }
  }

  /**
   * Clean up tokens that have been expired for more than 1 hour
   * Manual cleanup since we removed the TTL index
   */
  async cleanupExpiredTokens() {
    try {
      const mongoose = require('mongoose');
      if (!mongoose.models.Token) {
        return;
      }
      const Token = mongoose.models.Token;

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      
      const result = await Token.deleteMany({
        expiresAt: { $lte: oneHourAgo }
      });

      if (result.deletedCount > 0) {
        logger.info('[aresTokenRefresh] Cleaned up expired tokens', {
          deletedCount: result.deletedCount
        });
      }
    } catch (error) {
      logger.error('[aresTokenRefresh] Error cleaning up expired tokens', {
        error: error.message
      });
    }
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      refreshInterval: this.refreshInterval,
      userActivityThreshold: this.userActivityThreshold,
      nextRefresh: this.intervalId ? new Date(Date.now() + this.refreshInterval) : null
    };
  }
}

// Create singleton instance
const aresTokenRefreshService = new AresTokenRefreshService();

module.exports = {
  aresTokenRefreshService,
  AresTokenRefreshService
};