const { logger } = require('@librechat/data-schemas');
// Temporary: toggle token watcher logs via env flag
const TOKEN_LOGS_ENABLED = process.env.TOKEN_LOGS_ENABLED === 'true';

/**
 * Token watcher service - monitors when ARES tokens disappear from database
 * Helps debug why tokens are deleted after successful creation
 */

class TokenWatcher {
  constructor() {
    this.intervalId = null;
    this.isRunning = false;
    this.watchInterval = 60 * 1000; // Check every 60 seconds
    this.lastTokenState = new Map(); // Track token states
  }

  start() {
    if (this.isRunning) {
      return;
    }

    if (TOKEN_LOGS_ENABLED) console.log('[TokenWatcher] Starting token monitoring...');
    this.isRunning = true;

    // Run immediately
    this.checkTokens().catch((error) => {
      if (TOKEN_LOGS_ENABLED)
        console.error('[TokenWatcher] Error in initial check:', error.message);
    });

    // Then run every minute
    this.intervalId = setInterval(() => {
      this.checkTokens().catch((error) => {
        if (TOKEN_LOGS_ENABLED) console.error('[TokenWatcher] Error in check:', error.message);
      });
    }, this.watchInterval);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    if (TOKEN_LOGS_ENABLED) console.log('[TokenWatcher] Stopped token monitoring');
  }

  async checkTokens() {
    try {
      const mongoose = require('mongoose');
      if (!mongoose.models.Token) {
        return;
      }
      const Token = mongoose.models.Token;

      // Get all ARES tokens (both access and refresh)
      const allAresTokens = await Token.find({
        $or: [
          { type: 'oauth', identifier: 'ares' },
          { type: 'oauth_refresh', identifier: 'ares:refresh' },
        ],
      }).lean();

      const currentTime = new Date().toISOString();
      const currentState = new Map();

      if (TOKEN_LOGS_ENABLED)
        console.log(`\n[TokenWatcher] ${currentTime} - Found ${allAresTokens.length} ARES tokens`);

      if (allAresTokens.length === 0) {
        if (TOKEN_LOGS_ENABLED) console.log('[TokenWatcher] ❌ No ARES tokens found in database');

        // Check if we had tokens before but now they're gone
        if (this.lastTokenState.size > 0) {
          if (TOKEN_LOGS_ENABLED)
            console.log(
              '[TokenWatcher] 🚨 TOKENS DISAPPEARED! Previous state had tokens, now none found',
            );
          this.lastTokenState.forEach((token, key) => {
            if (TOKEN_LOGS_ENABLED)
              console.log(
                `[TokenWatcher] Lost token: ${key} - userId: ${token.userId}, type: ${token.type}, expired: ${new Date() > new Date(token.expiresAt)}`,
              );
          });
        }
      } else {
        allAresTokens.forEach((token) => {
          const key = `${token.userId}_${token.type}`;
          currentState.set(key, token);

          const now = new Date();
          const isExpired = token.expiresAt && now > token.expiresAt;
          const minutesLeft = token.expiresAt
            ? Math.round((token.expiresAt - now) / 60000)
            : 'no expiry';

          if (TOKEN_LOGS_ENABLED)
            console.log(
              `[TokenWatcher] ✅ ${token.type} token - userId: ${token.userId}, expires in: ${minutesLeft} min, expired: ${isExpired}`,
            );
          if (TOKEN_LOGS_ENABLED)
            console.log(
              `[TokenWatcher]    Created: ${token.createdAt}, Expires: ${token.expiresAt}, ID: ${token._id}`,
            );
        });
      }

      // Update last known state
      this.lastTokenState = currentState;
    } catch (error) {
      if (TOKEN_LOGS_ENABLED) console.error('[TokenWatcher] Error checking tokens:', error.message);
    }
  }
}

// Create singleton instance
const tokenWatcher = new TokenWatcher();

module.exports = {
  tokenWatcher,
};
