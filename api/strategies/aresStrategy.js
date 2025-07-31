const { Strategy: OAuth2Strategy } = require('passport-oauth2');
const socialLogin = require('./socialLogin');
const { logger } = require('@librechat/data-schemas');
const { createHandleOAuthToken } = require('@librechat/api');
const { findToken, createToken, updateToken } = require('~/models');

// Extract user profile details from ARES response
const getProfileDetails = ({ profile }) => ({
  email: profile.email,
  id: profile.id,
  avatarUrl: profile.picture || null,
  username: profile.email.split('@')[0], // Extract username from email
  name: profile.name,
  emailVerified: true, // Assume verified since coming from OAuth
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
      scope: ['user:read'], // Adjust scope as needed for ARES
      proxy: true,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // Fetch user profile from ARES user endpoint
        const fetch = (await import('node-fetch')).default;
        const response = await fetch('https://oauth.joinares.com/v1/user', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch user profile: ${response.status}`);
        }

        const userData = await response.json();
        logger.info('[aresStrategy] User data received:', { userId: userData.id });

        // Create a profile object that matches the expected format
        const profileData = {
          id: userData.id,
          email: userData.email,
          picture: userData.picture,
          name: userData.name,
        };

        // Use the social login handler first to get the MongoDB user
        return aresLogin(accessToken, refreshToken, null, profileData, async (err, user) => {
          if (err) {
            return done(err, null);
          }

          if (!user) {
            return done(new Error('Social login failed - no user returned'), null);
          }

          // Now store tokens using the correct MongoDB user ID
          try {
            const identifier = 'ares';
            const mongoUserId = user._id.toString();

            logger.info('[aresStrategy] Storing ARES tokens for MongoDB user', {
              aresUserId: userData.id,
              mongoUserId,
              email: user.email,
            });

            // Delete any existing tokens first to ensure fresh tokens
            const { deleteTokens } = require('~/models');
            await deleteTokens({ userId: mongoUserId, identifier });
            await deleteTokens({ userId: mongoUserId, identifier: `${identifier}:refresh` });

            // Create the token handler with database methods
            const handleOAuthToken = createHandleOAuthToken({
              findToken,
              updateToken,
              createToken,
            });

            // Always store fresh access token on every login
            await handleOAuthToken({
              userId: mongoUserId,
              identifier,
              token: accessToken,
              type: 'oauth',
              expiresIn: 1800, // ARES tokens expire quickly - 30 minutes
            });

            // Always store fresh refresh token if provided
            if (refreshToken) {
              await handleOAuthToken({
                userId: mongoUserId,
                identifier: `${identifier}:refresh`,
                token: refreshToken,
                type: 'oauth_refresh',
                expiresIn: 86400, // Refresh token expires in 24 hours
              });
            }

            logger.info('[aresStrategy] OAuth tokens updated successfully on login', {
              aresUserId: userData.id,
              mongoUserId,
              hasRefreshToken: !!refreshToken,
              timestamp: new Date().toISOString(),
            });
          } catch (tokenError) {
            logger.error('[aresStrategy] Failed to update OAuth tokens:', tokenError);
            // Continue with login even if token storage fails, but log this as critical
            logger.error('[aresStrategy] CRITICAL: User will not be able to access ARES resources');
          }

          // Return the user to complete the authentication
          return done(null, user);
        });
      } catch (error) {
        logger.error('[aresStrategy] Error in OAuth strategy:', error);
        return done(error, null);
      }
    },
  );

  strategy.name = 'ares';
  return strategy;
};
