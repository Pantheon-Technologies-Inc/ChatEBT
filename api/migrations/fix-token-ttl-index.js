const { logger } = require('@librechat/data-schemas');

/**
 * Migration to fix TTL index on tokens collection
 * Changes expireAfterSeconds from 0 to 600 (10 minutes grace period)
 */
async function fixTokenTTLIndex() {
  try {
    const { mongoose } = require('~/models');
    
    if (!mongoose || !mongoose.connection || mongoose.connection.readyState !== 1) {
      logger.warn('[Migration] MongoDB connection not ready, skipping TTL index fix');
      return false;
    }

    const db = mongoose.connection.db;
    const collection = db.collection('tokens');

    logger.info('[Migration] Starting TTL index migration');

    // Get current indexes
    const indexes = await collection.indexes();
    const ttlIndex = indexes.find(index => 
      index.key && index.key.expiresAt && index.expireAfterSeconds !== undefined
    );

    if (ttlIndex && ttlIndex.expireAfterSeconds === 600) {
      logger.info('[Migration] TTL index already has correct expireAfterSeconds value (600)');
      return true;
    }

    if (ttlIndex && ttlIndex.expireAfterSeconds === 0) {
      logger.info('[Migration] Found TTL index with expireAfterSeconds: 0, updating to 600');
      
      // Drop the old index
      try {
        await collection.dropIndex('expiresAt_1');
        logger.info('[Migration] ✓ Dropped old TTL index');
      } catch (error) {
        if (error.message.includes('index not found')) {
          logger.info('[Migration] ℹ Old TTL index not found (already dropped)');
        } else {
          throw error;
        }
      }
    }

    // Create new TTL index with 10-minute grace period
    await collection.createIndex(
      { expiresAt: 1 }, 
      { expireAfterSeconds: 600 }
    );
    
    logger.info('[Migration] ✓ Created new TTL index with 600 second grace period');
    return true;

  } catch (error) {
    logger.error('[Migration] Error fixing TTL index', {
      error: error.message,
      stack: error.stack
    });
    return false;
  }
}

module.exports = {
  fixTokenTTLIndex
};