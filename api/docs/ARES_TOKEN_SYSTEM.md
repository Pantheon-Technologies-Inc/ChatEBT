# ARES Token Management System

## 🚀 Overview

This system provides aggressive token management for ARES OAuth integration with automatic refresh, frequent checks, and forced re-authentication when needed.

## ✅ Key Features

- **Always Fresh Tokens**: Tokens are updated on EVERY login, not just the first time
- **Aggressive Refresh**: Tokens refresh 5 minutes before expiry (with 10-minute proactive refresh)
- **Auto Re-authentication**: Forces user to sign in again when refresh fails
- **Automatic Logout**: Users are automatically logged out when ARES tokens are invalid/expired
- **Background Maintenance**: Cron job runs every 5 minutes to keep all tokens fresh
- **Comprehensive Error Handling**: Proper error codes and fallback mechanisms

## 📁 Files Structure

```
api/
├── strategies/aresStrategy.js        # OAuth strategy - always updates tokens
├── utils/aresTokens.js              # Core token management utilities
├── examples/aresAPIExample.js       # Usage examples and middleware
├── cron/aresTokenMaintenance.js     # Background maintenance job
└── docs/ARES_TOKEN_SYSTEM.md       # This documentation
```

## 🔧 Core Functions

### `getAresAccessToken(userId, forceRefresh = false)`

- Gets valid access token for user
- Automatically refreshes if expired or expiring soon (5-minute buffer)
- Throws `ARES_AUTH_REQUIRED` error if refresh fails

### `callAresAPI(userId, endpoint, options)`

- Makes authenticated API calls to ARES
- Automatically retries with fresh token on 401 errors
- Handles all auth-related errors gracefully

### `refreshAresTokensIfNeeded(userId)`

- Proactively refreshes tokens expiring within 10 minutes
- Safe to call frequently - only refreshes when needed

### `hasValidAresToken(userId)`

- Checks if user has valid ARES authentication
- Returns `false` if re-authentication is needed

### `autoLogoutUser(req, res, reason)`

- Automatically logs out a user when ARES tokens are invalid
- Clears cookies, destroys sessions, and revokes ARES tokens
- Integrates with existing logout system

### `shouldAutoLogout(userId)`

- Checks if a user should be automatically logged out
- Returns `true` if user has no tokens or all tokens are expired

## 🔄 Token Lifecycle

### Login Flow

1. User authenticates with ARES
2. **OLD tokens are deleted** (ensures fresh tokens)
3. **NEW tokens are stored** with 30-minute expiry
4. User can access ARES resources

### API Call Flow

1. Get access token (auto-refresh if needed)
2. Make API call
3. If 401 error → force refresh → retry once
4. If still fails → throw `ARES_AUTH_REQUIRED`

### Background Maintenance

1. Cron job runs every 5 minutes
2. Finds all users with ARES tokens
3. Proactively refreshes tokens expiring within 10 minutes
4. Logs results for monitoring

## 🛡️ Error Handling

### Error Code: `ARES_AUTH_REQUIRED`

When you receive this error:

```javascript
if (error.code === 'ARES_AUTH_REQUIRED') {
  // Redirect user to ARES OAuth flow
  window.location.href = '/auth/ares';
}
```

### Middleware Usage

#### Auto-Logout Middleware (Recommended)

```javascript
const { aresTokenCheckMiddleware } = require('~/server/middleware');

// Global auto-logout - automatically logs out users with invalid ARES tokens
app.use(
  aresTokenCheckMiddleware({
    skipRoutes: ['/api/auth/', '/api/oauth/', '/health'],
    logOnly: false, // Set to true for testing without actual logout
  }),
);
```

#### Route Protection

```javascript
const { requireAresTokens } = require('~/server/middleware');

app.get('/api/protected', requireAresTokens(), async (req, res) => {
  // User guaranteed to have valid ARES tokens
  const data = await callAresAPI(req.user.id, 'some-endpoint');
  res.json(data);
});
```

#### Strict Token Checking

```javascript
const { strictAresTokenCheck } = require('~/server/middleware');

// For critical operations - enforces immediate logout
app.use('/api/critical/*', strictAresTokenCheck());
```

## ⚙️ Configuration

### Environment Variables

```env
ARES_CLIENT_ID=your_ares_client_id
ARES_CLIENT_SECRET=your_ares_client_secret
DISABLE_ARES_TOKEN_MAINTENANCE=false  # Set to true to disable background job
```

### Token Expiry Settings

- **Access Token**: 30 minutes (1800 seconds)
- **Refresh Token**: 24 hours (86400 seconds)
- **Refresh Buffer**: 5 minutes before expiry
- **Proactive Refresh**: 10 minutes before expiry

## 🔄 Setting Up Background Maintenance

Add to your main server file:

```javascript
const { setupAresTokenMaintenance } = require('~/cron/aresTokenMaintenance');

// Start the background maintenance job
setupAresTokenMaintenance();
```

## 📊 MongoDB Storage

Tokens are stored in the `tokens` collection:

```javascript
// Access Token Document
{
  userId: ObjectId("..."),
  type: "oauth",
  identifier: "ares",
  token: "encrypted_access_token",
  expiresAt: ISODate("..."),
  createdAt: ISODate("...")
}

// Refresh Token Document
{
  userId: ObjectId("..."),
  type: "oauth_refresh",
  identifier: "ares:refresh",
  token: "encrypted_refresh_token",
  expiresAt: ISODate("..."),
  createdAt: ISODate("...")
}
```

## 🎯 Usage Examples

### Simple API Call

```javascript
const { callAresAPI } = require('~/utils/aresTokens');

try {
  const profile = await callAresAPI(userId, 'user');
  console.log('User profile:', profile);
} catch (error) {
  if (error.code === 'ARES_AUTH_REQUIRED') {
    // Redirect to re-authenticate
    return res.redirect('/auth/ares');
  }
  throw error;
}
```

### Check Authentication Status

```javascript
const { hasValidAresToken } = require('~/utils/aresTokens');

if (await hasValidAresToken(userId)) {
  // User can access ARES resources
} else {
  // User needs to authenticate
}
```

### Manual Token Refresh

```javascript
const { refreshAresTokensIfNeeded } = require('~/utils/aresTokens');

// Call periodically to keep tokens fresh
await refreshAresTokensIfNeeded(userId);
```

## 🔍 Monitoring

The system provides comprehensive logging:

- Token refresh attempts
- API call successes/failures
- Background maintenance results
- Authentication failures

Search logs for `[aresTokens]` or `[aresStrategy]` to monitor the system.

## 🚨 Important Notes

1. **Tokens are updated on EVERY login** - no stale tokens
2. **5-minute refresh buffer** - tokens refresh before they expire
3. **Auto re-authentication** - users are forced to sign in when refresh fails
4. **Automatic logout** - users are automatically logged out when ARES tokens are invalid
5. **Background maintenance** - runs every 5 minutes to keep tokens fresh
6. **Comprehensive error handling** - proper error codes for frontend handling
7. **Complete session cleanup** - auto-logout clears cookies and destroys sessions

## 🔐 Auto-Logout Behavior

- **No ARES tokens**: User is automatically logged out
- **Expired access token + no refresh token**: Auto-logout
- **Expired access + expired refresh tokens**: Auto-logout
- **Failed token refresh**: Auto-logout
- **API call returns 401**: Attempt refresh, then auto-logout if failed

This system ensures your ARES integration is robust, secure, and always ready for API calls! 🎉
