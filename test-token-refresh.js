#!/usr/bin/env node

// Simple test script to verify the token refresh logic works
// Run this to test the fixes without waiting for the 15-minute interval

const { aresTokenRefreshService } = require('./api/services/aresTokenRefreshService');

console.log('Testing ARES token refresh service fixes...');

// Test the findTokensNeedingRefresh method directly
async function testTokenRefresh() {
  try {
    // Connect to MongoDB (reuse existing connection)
    require('./api/server/index');
    
    // Wait a moment for DB connection
    setTimeout(async () => {
      console.log('Running token refresh cycle test...');
      await aresTokenRefreshService.runRefreshCycle();
      console.log('Test completed. Check the logs above for results.');
      process.exit(0);
    }, 2000);
    
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

testTokenRefresh();