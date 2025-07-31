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

        // Store OAuth tokens in the database
        try {
          // Create the token handler with database methods
          const handleOAuthToken = createHandleOAuthToken({
            findToken,
            updateToken,
            createToken,
          });

          const identifier = 'ares';

          // Store access token
          await handleOAuthToken({
            userId: userData.id,
            identifier,
            token: accessToken,
            type: 'oauth',
            expiresIn: 3600, // ARES token expiry (adjust as needed)
          });

          // Store refresh token if provided
          if (refreshToken) {
            await handleOAuthToken({
              userId: userData.id,
              identifier: `${identifier}:refresh`,
              token: refreshToken,
              type: 'oauth_refresh',
              expiresIn: null, // Refresh tokens typically don't expire or have longer expiry
            });
          }

          logger.info('[aresStrategy] OAuth tokens stored successfully', {
            userId: userData.id,
            hasRefreshToken: !!refreshToken,
          });
        } catch (tokenError) {
          logger.error('[aresStrategy] Failed to store OAuth tokens:', tokenError);
          // Continue with login even if token storage fails
        }

        // Use the social login handler
        return aresLogin(accessToken, refreshToken, null, profileData, done);
      } catch (error) {
        logger.error('[aresStrategy] Error in OAuth strategy:', error);
        return done(error, null);
      }
    },
  );

  strategy.name = 'ares';
  return strategy;
};
