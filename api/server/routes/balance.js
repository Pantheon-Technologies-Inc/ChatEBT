const express = require('express');
const router = express.Router();
const controller = require('../controllers/Balance');
const { requireJwtAuth, requireAresTokens } = require('../middleware/');
const { getAresUserProfile } = require('~/utils/aresTokens');
const { logger } = require('@librechat/data-schemas');

// Existing balance endpoint
router.get('/', requireJwtAuth, controller);

// New ARES credits endpoint with proper security
router.get('/ares', requireJwtAuth, requireAresTokens(), async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;

    if (!userId) {
      return res.status(401).json({
        error: 'USER_NOT_AUTHENTICATED',
        message: 'User authentication required',
      });
    }

    // Fetch user profile from ARES including credits
    const aresProfile = await getAresUserProfile(userId);

    // Extract credits from the user data
    const credits = aresProfile?.user?.credits || 0;

    logger.info('[balance/ares] Credits fetched successfully', {
      userId,
      credits,
      timestamp: new Date().toISOString(),
    });

    res.json({
      message: 'Success',
      credits,
      user: {
        id: aresProfile?.user?.id,
        email: aresProfile?.user?.email,
        credits: aresProfile?.user?.credits,
      },
    });
  } catch (error) {
    logger.error('[balance/ares] Error fetching ARES credits:', error);

    if (error.code === 'ARES_AUTH_REQUIRED') {
      return res.status(401).json({
        error: 'ARES_AUTH_REQUIRED',
        message: 'ARES authentication required',
        redirectUrl: '/oauth/ares',
        autoLogout: true,
      });
    }

    res.status(500).json({
      error: 'FETCH_CREDITS_ERROR',
      message: 'Failed to fetch credits. Please try again.',
    });
  }
});

module.exports = router;
