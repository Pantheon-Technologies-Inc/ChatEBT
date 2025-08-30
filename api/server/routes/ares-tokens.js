const express = require('express');
const { logger } = require('@librechat/data-schemas');
const requireJwtAuth = require('../middleware/requireJwtAuth');
const { aresTokenRefreshService } = require('~/services/aresTokenRefreshService');

const router = express.Router();

/**
 * GET /api/ares-tokens/status
 * Get status of the background token refresh service
 */
router.get('/status', requireJwtAuth, (req, res) => {
  try {
    const status = aresTokenRefreshService.getStatus();
    res.json({
      success: true,
      status
    });
  } catch (error) {
    logger.error('[ares-tokens] Error getting service status', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get service status'
    });
  }
});

/**
 * POST /api/ares-tokens/refresh
 * Manually trigger a refresh cycle (admin only)
 */
router.post('/refresh', requireJwtAuth, async (req, res) => {
  try {
    // Only allow admins to trigger manual refresh
    if (!req.user.role || req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    logger.info('[ares-tokens] Manual refresh cycle triggered', { 
      userId: req.user.id,
      userEmail: req.user.email 
    });

    // Trigger refresh cycle in background
    aresTokenRefreshService.runRefreshCycle().catch(error => {
      logger.error('[ares-tokens] Error in manual refresh cycle', { error: error.message });
    });

    res.json({
      success: true,
      message: 'Refresh cycle triggered'
    });
  } catch (error) {
    logger.error('[ares-tokens] Error triggering manual refresh', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to trigger refresh cycle'
    });
  }
});

module.exports = router;