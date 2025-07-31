/**
 * ARES Token Maintenance Cron Job
 *
 * This file sets up a periodic maintenance job to keep ARES tokens fresh.
 * Tokens expire quickly, so this job runs frequently to proactively refresh them.
 */

const cron = require('node-cron');
const { logger } = require('@librechat/data-schemas');
const { refreshAresTokensIfNeeded } = require('../utils/aresTokens');
const { findUser } = require('~/models');

/**
 * Get all user IDs that have ARES tokens
 */
async function getUsersWithAresTokens() {
  try {
    const { findToken } = require('~/models');

    // Find all users with ARES tokens
    const tokens = await findToken.collection.distinct('userId', {
      identifier: 'ares',
      type: 'oauth',
    });

    return tokens.map((id) => id.toString());
  } catch (error) {
    logger.error('[aresTokenMaintenance] Error getting users with ARES tokens:', error);
    return [];
  }
}

/**
 * Maintenance job function
 */
async function runAresTokenMaintenance() {
  const startTime = Date.now();
  logger.info('[aresTokenMaintenance] Starting ARES token maintenance job');

  try {
    const userIds = await getUsersWithAresTokens();

    if (userIds.length === 0) {
      logger.info('[aresTokenMaintenance] No users with ARES tokens found');
      return;
    }

    logger.info('[aresTokenMaintenance] Processing tokens for users', { count: userIds.length });

    const results = {
      processed: 0,
      refreshed: 0,
      failed: 0,
      authRequired: 0,
    };

    // Process users in batches to avoid overwhelming the system
    const batchSize = 10;
    for (let i = 0; i < userIds.length; i += batchSize) {
      const batch = userIds.slice(i, i + batchSize);

      await Promise.allSettled(
        batch.map(async (userId) => {
          try {
            results.processed++;
            const refreshed = await refreshAresTokensIfNeeded(userId);

            if (refreshed) {
              results.refreshed++;
            } else {
              results.authRequired++;
            }
          } catch (error) {
            results.failed++;
            logger.error('[aresTokenMaintenance] Failed to refresh token for user:', {
              userId,
              error: error.message,
            });
          }
        }),
      );

      // Small delay between batches
      if (i + batchSize < userIds.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    const duration = Date.now() - startTime;
    logger.info('[aresTokenMaintenance] Token maintenance completed', {
      ...results,
      durationMs: duration,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('[aresTokenMaintenance] Token maintenance job failed:', {
      error: error.message,
      durationMs: duration,
    });
  }
}

/**
 * Setup cron jobs for token maintenance
 */
function setupAresTokenMaintenance() {
  if (process.env.DISABLE_ARES_TOKEN_MAINTENANCE === 'true') {
    logger.info('[aresTokenMaintenance] ARES token maintenance disabled by environment variable');
    return;
  }

  // Run every 5 minutes to catch expiring tokens early
  const job = cron.schedule('*/5 * * * *', runAresTokenMaintenance, {
    scheduled: false, // Don't start automatically
    timezone: 'UTC',
  });

  // Start the job
  job.start();
  logger.info('[aresTokenMaintenance] ARES token maintenance job scheduled (every 5 minutes)');

  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('[aresTokenMaintenance] Shutting down ARES token maintenance job');
    job.destroy();
  });

  process.on('SIGINT', () => {
    logger.info('[aresTokenMaintenance] Shutting down ARES token maintenance job');
    job.destroy();
  });

  return job;
}

/**
 * Manual trigger for token maintenance (useful for testing)
 */
async function triggerManualMaintenance() {
  logger.info('[aresTokenMaintenance] Manual token maintenance triggered');
  await runAresTokenMaintenance();
}

module.exports = {
  setupAresTokenMaintenance,
  runAresTokenMaintenance,
  triggerManualMaintenance,
  getUsersWithAresTokens,
};
