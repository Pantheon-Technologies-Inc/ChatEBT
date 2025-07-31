# ARES Auto-Logout Setup Guide

## 🚀 Quick Setup

### 1. Add Auto-Logout Middleware

Add this to your main server file (e.g., `server/index.js`):

```javascript
const { aresTokenCheckMiddleware } = require('~/server/middleware');

// Add AFTER authentication middleware but BEFORE your routes
app.use(
  aresTokenCheckMiddleware({
    skipRoutes: ['/api/auth/', '/api/oauth/', '/health', '/api/config'],
    logOnly: false, // Set to true for testing without actual logout
  }),
);
```

### 2. Handle Auto-Logout in Frontend

Update your frontend error handling to detect auto-logout:

```javascript
// In your API client or error handler
if (error.response?.data?.autoLogout) {
  // User has been automatically logged out
  localStorage.clear(); // Clear any local storage
  sessionStorage.clear(); // Clear session storage
  window.location.href = '/login'; // Redirect to login
}

// Check for specific auto-logout error codes
if (error.response?.data?.error === 'ARES_AUTH_EXPIRED') {
  // Show user-friendly message
  alert('Your session has expired. Please sign in again.');
  window.location.href = '/login';
}
```

### 3. Optional: Background Token Maintenance

Add to your server startup:

```javascript
const { setupAresTokenMaintenance } = require('~/cron/aresTokenMaintenance');

// Start background job to keep tokens fresh
setupAresTokenMaintenance();
```

## 🔧 Configuration Options

### Middleware Options

```javascript
app.use(
  aresTokenCheckMiddleware({
    // Routes to skip auto-logout checking
    skipRoutes: [
      '/api/auth/', // Authentication routes
      '/api/oauth/', // OAuth callback routes
      '/health', // Health check
      '/api/config', // Public config
      '/static/', // Static files
    ],

    // Only log violations without actual logout (for testing)
    logOnly: false,
  }),
);
```

### Environment Variables

```env
# Disable background token maintenance if needed
DISABLE_ARES_TOKEN_MAINTENANCE=false
```

## 🛡️ Testing Auto-Logout

### Test Endpoints

Add these test routes to verify auto-logout works:

```javascript
// Test if user should be logged out
app.post('/api/test/check-logout', requireJwtAuth, async (req, res) => {
  const { shouldAutoLogout } = require('~/utils/aresTokens');
  const shouldLogout = await shouldAutoLogout(req.user.id);
  res.json({ shouldLogout });
});

// Manually trigger auto-logout
app.post('/api/test/trigger-logout', requireJwtAuth, async (req, res) => {
  const { autoLogoutUser } = require('~/utils/aresTokens');
  const success = await autoLogoutUser(req, res, 'Manual test');
  res.json({ success, message: 'Auto-logout triggered' });
});
```

### Test Scenarios

1. **No ARES tokens**: Remove user's ARES tokens from database
2. **Expired tokens**: Set token `expiresAt` to past date
3. **Failed refresh**: Remove refresh token but keep expired access token

## 📊 Monitoring

### Key Log Messages

Search for these in your logs:

```bash
# Auto-logout events
grep "\[aresTokens\] Auto-logging out user" logs/

# Token refresh attempts
grep "\[aresTokens\] Token expired/expiring soon" logs/

# Background maintenance
grep "\[aresTokenMaintenance\]" logs/

# Middleware actions
grep "\[aresTokenCheck\]" logs/
```

### Metrics to Track

- Auto-logout frequency
- Token refresh success rate
- Background maintenance results
- User re-authentication rate

## 🔍 Troubleshooting

### Common Issues

1. **Users logged out too frequently**

   - Check token expiry settings (default: 30 minutes)
   - Verify background maintenance is running
   - Check for network issues affecting token refresh

2. **Auto-logout not working**

   - Verify middleware is properly installed
   - Check skipRoutes configuration
   - Ensure ARES tokens exist in database

3. **Performance issues**
   - Reduce auto-logout check frequency
   - Optimize database queries
   - Use logOnly mode for debugging

### Debug Mode

Enable detailed logging:

```javascript
app.use(
  aresTokenCheckMiddleware({
    skipRoutes: ['/api/auth/', '/api/oauth/'],
    logOnly: true, // Enable this for debugging
  }),
);
```

## ✅ Verification Checklist

- [ ] Auto-logout middleware installed
- [ ] Frontend handles auto-logout responses
- [ ] Background maintenance running (optional)
- [ ] Test endpoints work correctly
- [ ] Logs show auto-logout events
- [ ] Users can re-authenticate after logout

## 🎯 Best Practices

1. **Graceful UX**: Show clear messages when users are auto-logged out
2. **Preserve state**: Save user work before redirecting to login
3. **Monitor closely**: Track auto-logout frequency in production
4. **Test thoroughly**: Verify auto-logout works in all scenarios
5. **Performance**: Use logOnly mode for testing without disruption

Your ARES auto-logout system is now ready! 🎉
