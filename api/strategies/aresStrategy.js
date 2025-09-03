const { Strategy: OAuth2Strategy } = require('passport-oauth2');
const { logger } = require('@librechat/data-schemas');
const socialLogin = require('./socialLogin');
const { createHandleOAuthToken } = require('@librechat/api');
const { findToken, createToken, updateToken } = require('~/models');

/**
 * Production-ready ARES OAuth Strategy
 * Simplified, secure, and follows LibreChat conventions
 */

const getProfileDetails = ({ profile }) => ({
  email: profile.email,
  id: profile.id,
  avatarUrl: profile.picture || null,
  username: profile.email.split('@')[0],
  name: profile.name,
  emailVerified: true,
});

const aresLogin = socialLogin('ares', getProfileDetails);

module.exports = () => {
  const strategy = new OAuth2Strategy(
    {
      authorizationURL: 'https://joinares.com/oauth',
      tokenURL: 'https://oauth.joinares.com/oauth/token',
      clientID: process.env.ARES_CLIENT_ID,
      clientSecret: process.env.ARES_CLIENT_SECRET,
      callbackURL: `${process.env.DOMAIN_SERVER}/oauth/ares/callback`,
      scope: ['user:read'],
      proxy: true,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // Fetch user profile from ARES
        const fetch = (await import('node-fetch')).default;
        const response = await fetch('https://oauth.joinares.com/v1/user', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          logger.error('[aresStrategy] Failed to fetch user profile', {
            status: response.status,
            statusText: response.statusText
          });
          throw new Error(`Failed to fetch user profile: ${response.status}`);
        }

        const userData = await response.json();
        logger.info('[aresStrategy] User data received', { 
          userId: userData.id,
          email: userData.email 
        });

        // Create profile object
        const profileData = {
          id: userData.id,
          email: userData.email,
          picture: userData.picture,
          name: userData.name,
        };

        // Use standard social login handler
        return aresLogin(accessToken, refreshToken, null, profileData, async (err, user) => {
          if (err) {
            logger.error('[aresStrategy] Social login error', err);
            return done(err, null);
          }

          if (!user) {
            logger.error('[aresStrategy] Social login failed - no user returned');
            return done(new Error('Social login failed - no user returned'), null);
          }

          try {
            // Store ARES tokens securely using LibreChat's token system
            const mongoUserId = user._id.toString();
            const identifier = 'ares';

            logger.info('[aresStrategy] Storing ARES tokens', {
              aresUserId: userData.id,
              mongoUserId,
              email: user.email,
              hasRefreshToken: !!refreshToken
            });

            // Create token handler with database methods
            const handleOAuthToken = createHandleOAuthToken({
              findToken,
              updateToken,
              createToken,
            });

            // Clean up any existing ARES tokens first to ensure proper pairing
            const { deleteTokens } = require('~/models');
            const deleteResults = await Promise.all([
              deleteTokens({ userId: mongoUserId, identifier }),
              deleteTokens({ userId: mongoUserId, identifier: `${identifier}:refresh` })
            ]);

            logger.info('[aresStrategy] Cleaned up existing ARES tokens', { 
              mongoUserId,
              deletedAccessTokens: deleteResults[0]?.deletedCount || 0,
              deletedRefreshTokens: deleteResults[1]?.deletedCount || 0
            });

            // Store access token
            await handleOAuthToken({
              userId: mongoUserId,
              identifier,
              token: accessToken,
              type: 'oauth',
              expiresIn: 1800, // 30 minutes
            });

            // Store refresh token if provided
            if (refreshToken) {
              await handleOAuthToken({
                userId: mongoUserId,
                identifier: `${identifier}:refresh`,
                token: refreshToken,
                type: 'oauth_refresh',
                expiresIn: 86400, // 24 hours
              });
            }

            // Verify tokens were actually saved by checking database
            const { findToken } = require('~/models');
            const savedAccessToken = await findToken({
              userId: mongoUserId,
              type: 'oauth',
              identifier
            });
            
            const savedRefreshToken = refreshToken ? await findToken({
              userId: mongoUserId,
              type: 'oauth_refresh', 
              identifier: `${identifier}:refresh`
            }) : null;

            logger.info('[aresStrategy] ARES tokens stored and verified', {
              mongoUserId,
              hasRefreshToken: !!refreshToken,
              accessTokenSaved: !!savedAccessToken,
              refreshTokenSaved: !!savedRefreshToken,
              accessTokenId: savedAccessToken?._id?.toString(),
              refreshTokenId: savedRefreshToken?._id?.toString(),
              accessTokenExpiry: savedAccessToken?.expiresAt?.toISOString(),
              refreshTokenExpiry: savedRefreshToken?.expiresAt?.toISOString(),
              timestamp: new Date().toISOString(),
            });

            // If tokens weren't saved, something is wrong
            if (!savedAccessToken) {
              logger.error('[aresStrategy] CRITICAL: Access token not found after creation!', {
                mongoUserId,
                identifier
              });
            }
            if (refreshToken && !savedRefreshToken) {
              logger.error('[aresStrategy] CRITICAL: Refresh token not found after creation!', {
                mongoUserId,
                identifier: `${identifier}:refresh`
              });
            }

            return done(null, user);

          } catch (tokenError) {
            console.error('[aresStrategy] CRITICAL TOKEN STORAGE FAILURE:');
            console.error('Error message:', tokenError.message);
            console.error('Error stack:', tokenError.stack);
            console.error('User ID:', user._id?.toString());
            console.error('Access token length:', accessToken?.length);
            console.error('Refresh token length:', refreshToken?.length);
            
            logger.error('[aresStrategy] Failed to store ARES tokens', {
              error: tokenError.message,
              userId: user._id?.toString(),
              stack: tokenError.stack,
              hasAccessToken: !!accessToken,
              hasRefreshToken: !!refreshToken
            });
            
            // Continue with login even if token storage fails
            // User will be prompted to re-authenticate when they try to access ARES resources
            logger.warn('[aresStrategy] Continuing with login despite token storage failure');
            return done(null, user);
          }
        });

      } catch (error) {
        logger.error('[aresStrategy] OAuth strategy error', {
          error: error.message,
          stack: error.stack
        });
        return done(error, null);
      }
    },
  );

  strategy.name = 'ares';
  return strategy;
};