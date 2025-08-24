#!/usr/bin/env node

/**
 * ARES OAuth Load Testing Script
 * Tests token refresh under high concurrency to ensure no race conditions
 */

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { performance } = require('perf_hooks');

class AresLoadTest {
  constructor() {
    this.baseUrl = process.env.DOMAIN_SERVER || 'http://localhost:3080';
    this.results = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      tokenRefreshes: 0,
      raceConditionErrors: 0,
      errors: []
    };
  }

  async runLoadTest() {
    console.log('🚀 ARES OAuth Load Test Starting...\n');
    console.log(`Target URL: ${this.baseUrl}`);
    console.log('Simulating high-concurrency token refresh scenarios...\n');

    await this.testConcurrentTokenRefresh();
    await this.testRateLimiting();
    await this.testErrorHandling();

    this.printResults();
  }

  async testConcurrentTokenRefresh() {
    console.log('🔄 Testing Concurrent Token Refresh...');
    
    const concurrentUsers = 50;
    const requestsPerUser = 10;
    const workers = [];
    const startTime = performance.now();

    // Create worker threads to simulate concurrent users
    for (let i = 0; i < concurrentUsers; i++) {
      const worker = new Worker(__filename, {
        workerData: {
          testType: 'tokenRefresh',
          userId: `user_${i}`,
          requestCount: requestsPerUser,
          baseUrl: this.baseUrl
        }
      });

      workers.push(worker);
    }

    // Wait for all workers to complete
    const results = await Promise.all(
      workers.map(worker => new Promise((resolve, reject) => {
        worker.on('message', resolve);
        worker.on('error', reject);
        worker.on('exit', (code) => {
          if (code !== 0) {
            reject(new Error(`Worker stopped with exit code ${code}`));
          }
        });
      }))
    );

    const endTime = performance.now();
    const duration = endTime - startTime;

    // Aggregate results
    for (const result of results) {
      this.results.totalRequests += result.totalRequests;
      this.results.successfulRequests += result.successfulRequests;
      this.results.failedRequests += result.failedRequests;
      this.results.tokenRefreshes += result.tokenRefreshes;
      this.results.raceConditionErrors += result.raceConditionErrors;
      this.results.errors.push(...result.errors);
    }

    this.results.averageResponseTime = duration / this.results.totalRequests;

    console.log(`✅ Concurrent token refresh test completed in ${Math.round(duration)}ms`);
  }

  async testRateLimiting() {
    console.log('⏱️  Testing Rate Limiting...');
    
    const { AresRateLimiter } = require('../api/utils/aresValidation');
    const rateLimiter = new AresRateLimiter();
    const testUserId = '507f1f77bcf86cd799439011';
    
    let requestsBlocked = 0;
    let requestsAllowed = 0;

    // Make 100 requests rapidly
    for (let i = 0; i < 100; i++) {
      if (rateLimiter.checkRateLimit(testUserId)) {
        requestsAllowed++;
      } else {
        requestsBlocked++;
      }
    }

    if (requestsBlocked === 0) {
      this.results.errors.push({
        type: 'Rate Limiting',
        message: 'Rate limiting not working - no requests were blocked',
        severity: 'HIGH'
      });
    }

    console.log(`✅ Rate limiting test: ${requestsAllowed} allowed, ${requestsBlocked} blocked`);
  }

  async testErrorHandling() {
    console.log('🔧 Testing Error Handling...');
    
    const errorScenarios = [
      { name: 'Invalid User ID', userId: 'invalid' },
      { name: 'Empty User ID', userId: '' },
      { name: 'Very Long User ID', userId: 'a'.repeat(1000) },
      { name: 'SQL Injection Attempt', userId: "'; DROP TABLE users; --" },
    ];

    for (const scenario of errorScenarios) {
      try {
        const { hasValidAresTokens } = require('../api/utils/aresClient');
        const result = await hasValidAresTokens(scenario.userId);
        
        // Should return false for invalid inputs, not throw errors
        if (result !== false) {
          this.results.errors.push({
            type: 'Error Handling',
            message: `${scenario.name}: Unexpected result ${result}`,
            severity: 'MEDIUM'
          });
        }
      } catch (error) {
        // Errors are expected for some invalid inputs, but shouldn't crash
        if (error.message.includes('database') || error.message.includes('connection')) {
          this.results.errors.push({
            type: 'Error Handling',
            message: `${scenario.name}: Database error leaked: ${error.message}`,
            severity: 'HIGH'
          });
        }
      }
    }

    console.log('✅ Error handling test completed');
  }

  printResults() {
    console.log('\n' + '='.repeat(80));
    console.log('🚀 ARES OAUTH LOAD TEST RESULTS');
    console.log('='.repeat(80));

    console.log('\n📊 PERFORMANCE METRICS:');
    console.log(`   Total Requests: ${this.results.totalRequests}`);
    console.log(`   Successful: ${this.results.successfulRequests} (${Math.round(this.results.successfulRequests / this.results.totalRequests * 100)}%)`);
    console.log(`   Failed: ${this.results.failedRequests} (${Math.round(this.results.failedRequests / this.results.totalRequests * 100)}%)`);
    console.log(`   Average Response Time: ${Math.round(this.results.averageResponseTime)}ms`);
    console.log(`   Token Refreshes: ${this.results.tokenRefreshes}`);
    console.log(`   Race Condition Errors: ${this.results.raceConditionErrors}`);

    if (this.results.errors.length === 0) {
      console.log('\n🎉 NO ERRORS DETECTED! System is ready for high load.');
    } else {
      console.log('\n🚨 ERRORS DETECTED:');
      
      const errorBySeverity = {
        HIGH: this.results.errors.filter(e => e.severity === 'HIGH'),
        MEDIUM: this.results.errors.filter(e => e.severity === 'MEDIUM'),
        LOW: this.results.errors.filter(e => e.severity === 'LOW'),
      };

      for (const [severity, errors] of Object.entries(errorBySeverity)) {
        if (errors.length > 0) {
          console.log(`\n${severity} SEVERITY (${errors.length}):`);
          for (const error of errors) {
            console.log(`   • [${error.type}] ${error.message}`);
          }
        }
      }
    }

    console.log('\n🎯 RECOMMENDATIONS:');
    
    if (this.results.averageResponseTime > 1000) {
      console.log('   • Response times are high - consider optimization');
    }
    
    if (this.results.failedRequests > this.results.totalRequests * 0.01) {
      console.log('   • Error rate > 1% - investigate failed requests');
    }
    
    if (this.results.raceConditionErrors > 0) {
      console.log('   • Race condition errors detected - review token refresh logic');
    }

    console.log('\n' + '='.repeat(80));

    // Exit with appropriate code
    const highSeverityErrors = this.results.errors.filter(e => e.severity === 'HIGH').length;
    if (highSeverityErrors > 0 || this.results.raceConditionErrors > 0) {
      console.log('❌ LOAD TEST FAILED: Critical issues detected');
      process.exit(1);
    } else {
      console.log('✅ LOAD TEST PASSED: System ready for production load');
      process.exit(0);
    }
  }
}

// Worker thread logic
if (!isMainThread) {
  const { testType, userId, requestCount, baseUrl } = workerData;
  
  async function workerTask() {
    const result = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      tokenRefreshes: 0,
      raceConditionErrors: 0,
      errors: []
    };

    if (testType === 'tokenRefresh') {
      // Simulate token refresh operations
      for (let i = 0; i < requestCount; i++) {
        result.totalRequests++;
        
        try {
          const { hasValidAresTokens } = require('../api/utils/aresClient');
          const hasTokens = await hasValidAresTokens(userId);
          
          if (hasTokens !== false) {
            result.successfulRequests++;
          } else {
            result.failedRequests++;
          }
          
        } catch (error) {
          result.failedRequests++;
          
          if (error.message.includes('race') || error.message.includes('concurrent')) {
            result.raceConditionErrors++;
          }
          
          result.errors.push({
            type: 'Token Refresh',
            message: error.message,
            severity: 'MEDIUM'
          });
        }

        // Small delay to simulate real usage
        await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
      }
    }

    parentPort.postMessage(result);
  }

  workerTask().catch(error => {
    parentPort.postMessage({
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 1,
      tokenRefreshes: 0,
      raceConditionErrors: 1,
      errors: [{
        type: 'Worker Error',
        message: error.message,
        severity: 'HIGH'
      }]
    });
  });
}

// Run load test if called directly
if (require.main === module && isMainThread) {
  const loadTest = new AresLoadTest();
  loadTest.runLoadTest().catch(console.error);
}

module.exports = AresLoadTest;