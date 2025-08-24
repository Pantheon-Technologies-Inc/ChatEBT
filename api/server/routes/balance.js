const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../middleware/');
const { getAresUserProfile } = require('~/utils/aresClient');
const { logger } = require('@librechat/data-schemas');

/**
 * Production-ready ARES balance endpoint
 * Uses simplified token system with proper error handling
 */

// ARES credits endpoint with comprehensive error handling
router.get('/', requireJwtAuth, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const userId = req.user?.id || req.user?._id;

    // Validate user authentication
    if (!userId) {
      logger.warn('[balance] Request without user ID', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        timestamp: new Date().toISOString()
      });
      
      return res.status(401).json({
        error: 'AUTHENTICATION_REQUIRED',
        message: 'User authentication required',
      });
    }

    // Validate user ID format
    if (typeof userId !== 'string' || userId.length < 10) {
      logger.warn('[balance] Invalid user ID format', { 
        userId: typeof userId === 'string' ? userId.substring(0, 8) + '...' : typeof userId,
        ip: req.ip 
      });
      
      return res.status(400).json({
        error: 'INVALID_USER_ID',
        message: 'Invalid user identifier',
      });
    }

    logger.info('[balance] Fetching ARES credits', {
      userId: userId.substring(0, 8) + '...',
      ip: req.ip,
      userAgent: req.get('User-Agent')?.substring(0, 50),
      timestamp: new Date().toISOString()
    });

    // Fetch user profile from ARES
    const aresProfile = await getAresUserProfile(userId);

    // Validate ARES response
    if (!aresProfile || typeof aresProfile !== 'object') {
      logger.error('[balance] Invalid ARES profile response', {
        userId: userId.substring(0, 8) + '...',
        profileType: typeof aresProfile,
        hasProfile: !!aresProfile
      });
      
      return res.status(503).json({
        error: 'SERVICE_UNAVAILABLE',
        message: 'ARES service temporarily unavailable. Please try again.',
      });
    }

    // Extract credits safely
    const credits = aresProfile?.user?.credits || 0;
    const userInfo = aresProfile?.user || {};

    // Validate credits value
    if (typeof credits !== 'number' || credits < 0 || !Number.isFinite(credits)) {
      logger.warn('[balance] Invalid credits value from ARES', {
        userId: userId.substring(0, 8) + '...',
        credits,
        creditsType: typeof credits
      });
    }

    const duration = Date.now() - startTime;
    
    logger.info('[balance] Credits fetched successfully', {
      userId: userId.substring(0, 8) + '...',
      credits,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
    });

    // Sanitize user info before sending
    const sanitizedUser = {
      id: userInfo.id || null,
      email: userInfo.email || null,
      credits: Math.max(0, Math.floor(credits)), // Ensure non-negative integer
    };

    res.json({
      message: 'Success',
      credits: sanitizedUser.credits,
      user: sanitizedUser,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    
    logger.error('[balance] Error fetching credits', {
      userId: req.user?.id?.substring(0, 8) + '...' || 'unknown',
      error: error.message,
      code: error.code,
      duration: `${duration}ms`,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });

    // Handle specific ARES authentication errors
    if (error.code === 'ARES_AUTH_REQUIRED') {
      return res.status(401).json({
        error: 'ARES_AUTH_REQUIRED',
        message: 'ARES authentication required. Please sign in with ARES.',
        redirectUrl: '/oauth/ares',
        timestamp: new Date().toISOString(),
      });
    }

    // Handle network/timeout errors
    if (error.name === 'FetchError' || error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return res.status(503).json({
        error: 'SERVICE_UNAVAILABLE',
        message: 'ARES service temporarily unavailable. Please try again.',
        timestamp: new Date().toISOString(),
      });
    }

    // Handle rate limiting
    if (error.message.includes('rate limit') || error.message.includes('429')) {
      return res.status(429).json({
        error: 'RATE_LIMITED',
        message: 'Too many requests. Please try again in a moment.',
        timestamp: new Date().toISOString(),
      });
    }

    // Generic error response
    res.status(500).json({
      error: 'FETCH_BALANCE_ERROR',
      message: 'Failed to fetch balance. Please try again.',
      timestamp: new Date().toISOString(),
    });
  }
});

// Health check endpoint for ARES integration
router.get('/health', requireJwtAuth, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    
    if (!userId) {
      return res.status(401).json({ 
        status: 'error', 
        message: 'Authentication required' 
      });
    }

    const { hasValidAresTokens } = require('~/utils/aresClient');
    const hasTokens = await hasValidAresTokens(userId);

    res.json({
      status: 'ok',
      hasAresTokens: hasTokens,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('[balance/health] Health check failed', {
      error: error.message,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      status: 'error',
      message: 'Health check failed',
      timestamp: new Date().toISOString(),
    });
  }
});

module.exports = router;