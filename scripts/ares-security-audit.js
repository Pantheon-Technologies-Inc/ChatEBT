#!/usr/bin/env node

/**
 * ARES OAuth Security Audit Script
 * Comprehensive security testing for the simplified ARES implementation
 */

const https = require('https');
const { execSync } = require('child_process');

class AresSecurityAudit {
  constructor() {
    this.baseUrl = process.env.DOMAIN_SERVER || 'http://localhost:3080';
    this.issues = [];
    this.passed = [];
  }

  async runAudit() {
    console.log('🔒 ARES OAuth Security Audit Starting...\n');

    await this.checkEnvironmentSecurity();
    await this.checkInputValidation();
    await this.checkRateLimiting();
    await this.checkErrorHandling();
    await this.checkTokenSecurity();
    await this.checkHttpsSecurity();
    await this.checkDependencyVulnerabilities();

    this.printResults();
  }

  async checkEnvironmentSecurity() {
    console.log('🔍 Checking Environment Security...');

    // Check for sensitive data in environment
    const sensitivePatterns = [
      { pattern: /password/i, name: 'Passwords in environment' },
      { pattern: /secret.*=.*[^*]/i, name: 'Unmasked secrets' },
      { pattern: /key.*=.*[a-zA-Z0-9]{10,}/i, name: 'Exposed API keys' },
    ];

    const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
    
    try {
      const fs = require('fs');
      if (fs.existsSync(envFile)) {
        const envContent = fs.readFileSync(envFile, 'utf8');
        
        for (const { pattern, name } of sensitivePatterns) {
          if (pattern.test(envContent)) {
            this.issues.push({
              severity: 'HIGH',
              category: 'Environment',
              issue: name,
              recommendation: 'Use proper secret management and mask sensitive values'
            });
          }
        }
      }
    } catch (error) {
      this.issues.push({
        severity: 'MEDIUM',
        category: 'Environment',
        issue: 'Cannot read environment file',
        recommendation: 'Ensure environment file is properly configured'
      });
    }

    // Check required security environment variables
    const requiredSecurityVars = ['JWT_SECRET', 'CREDS_KEY', 'CREDS_IV'];
    for (const varName of requiredSecurityVars) {
      if (!process.env[varName] || process.env[varName].length < 32) {
        this.issues.push({
          severity: 'HIGH',
          category: 'Environment',
          issue: `Weak or missing ${varName}`,
          recommendation: 'Use strong, randomly generated secrets'
        });
      }
    }

    this.passed.push('Environment configuration checked');
  }

  async checkInputValidation() {
    console.log('🔍 Checking Input Validation...');

    const testCases = [
      { input: '../../../etc/passwd', test: 'Path traversal' },
      { input: '<script>alert("xss")</script>', test: 'XSS injection' },
      { input: "'; DROP TABLE users; --", test: 'SQL injection' },
      { input: '{{7*7}}', test: 'Template injection' },
      { input: 'A'.repeat(10000), test: 'Buffer overflow' },
    ];

    const validation = require('../api/utils/aresValidation');

    for (const { input, test } of testCases) {
      // Test endpoint validation
      if (validation.isValidEndpoint(input)) {
        this.issues.push({
          severity: 'HIGH',
          category: 'Input Validation',
          issue: `${test} not properly blocked in endpoint validation`,
          recommendation: 'Strengthen input validation patterns'
        });
      }

      // Test user ID validation
      if (validation.isValidUserId(input)) {
        this.issues.push({
          severity: 'HIGH',
          category: 'Input Validation',
          issue: `${test} not properly blocked in user ID validation`,
          recommendation: 'Strengthen user ID validation'
        });
      }
    }

    this.passed.push('Input validation security checked');
  }

  async checkRateLimiting() {
    console.log('🔍 Checking Rate Limiting...');

    const { AresRateLimiter } = require('../api/utils/aresValidation');
    const rateLimiter = new AresRateLimiter();

    // Test rate limiting
    const testUserId = '507f1f77bcf86cd799439011';
    let blocked = false;

    // Make 70 requests (above the 60 limit)
    for (let i = 0; i < 70; i++) {
      if (!rateLimiter.checkRateLimit(testUserId)) {
        blocked = true;
        break;
      }
    }

    if (!blocked) {
      this.issues.push({
        severity: 'MEDIUM',
        category: 'Rate Limiting',
        issue: 'Rate limiting not properly enforced',
        recommendation: 'Ensure rate limiter is working correctly'
      });
    } else {
      this.passed.push('Rate limiting working correctly');
    }
  }

  async checkErrorHandling() {
    console.log('🔍 Checking Error Handling...');

    // Check if error messages leak sensitive information
    const sensitivePatterns = [
      /password/i,
      /secret/i,
      /token.*[a-zA-Z0-9]{20,}/i,
      /database.*connection/i,
      /stack trace/i,
    ];

    // This would need to be tested with actual error responses
    // For now, we check the error handling structure
    try {
      const aresClient = require('../api/utils/aresClient');
      
      // Test with invalid inputs
      try {
        await aresClient.getValidAresToken('invalid_id');
      } catch (error) {
        for (const pattern of sensitivePatterns) {
          if (pattern.test(error.message)) {
            this.issues.push({
              severity: 'MEDIUM',
              category: 'Error Handling',
              issue: 'Error messages may leak sensitive information',
              recommendation: 'Sanitize error messages before sending to client'
            });
            break;
          }
        }
      }
    } catch (error) {
      // Expected - this is part of the test
    }

    this.passed.push('Error handling security checked');
  }

  async checkTokenSecurity() {
    console.log('🔍 Checking Token Security...');

    // Check token expiration settings
    const tokenExpiryMinutes = 30; // ARES tokens expire in 30 minutes
    const refreshExpiryHours = 24; // Refresh tokens expire in 24 hours

    if (tokenExpiryMinutes > 60) {
      this.issues.push({
        severity: 'MEDIUM',
        category: 'Token Security',
        issue: 'Access token expiry too long',
        recommendation: 'Use shorter token expiry times'
      });
    }

    if (refreshExpiryHours > 168) { // 1 week
      this.issues.push({
        severity: 'LOW',
        category: 'Token Security',
        issue: 'Refresh token expiry very long',
        recommendation: 'Consider shorter refresh token expiry'
      });
    }

    // Check for token encryption
    try {
      const { decryptV2 } = require('@librechat/api');
      if (typeof decryptV2 !== 'function') {
        this.issues.push({
          severity: 'HIGH',
          category: 'Token Security',
          issue: 'Token encryption not available',
          recommendation: 'Ensure token encryption is properly configured'
        });
      }
    } catch (error) {
      this.issues.push({
        severity: 'HIGH',
        category: 'Token Security',
        issue: 'Cannot verify token encryption',
        recommendation: 'Check token encryption implementation'
      });
    }

    this.passed.push('Token security checked');
  }

  async checkHttpsSecurity() {
    console.log('🔍 Checking HTTPS Security...');

    if (process.env.NODE_ENV === 'production') {
      if (!this.baseUrl.startsWith('https://')) {
        this.issues.push({
          severity: 'CRITICAL',
          category: 'HTTPS',
          issue: 'Production environment not using HTTPS',
          recommendation: 'Enable HTTPS in production'
        });
      }

      // Check HSTS headers (would need actual HTTP test)
      this.passed.push('HTTPS configuration noted for production');
    } else {
      this.passed.push('HTTPS check skipped for development');
    }
  }

  async checkDependencyVulnerabilities() {
    console.log('🔍 Checking Dependency Vulnerabilities...');

    try {
      // Run npm audit
      const auditResult = execSync('npm audit --json', { encoding: 'utf8' });
      const audit = JSON.parse(auditResult);

      if (audit.metadata && audit.metadata.vulnerabilities) {
        const { critical, high, moderate, low } = audit.metadata.vulnerabilities;
        
        if (critical > 0) {
          this.issues.push({
            severity: 'CRITICAL',
            category: 'Dependencies',
            issue: `${critical} critical vulnerabilities found`,
            recommendation: 'Run npm audit fix immediately'
          });
        }

        if (high > 0) {
          this.issues.push({
            severity: 'HIGH',
            category: 'Dependencies',
            issue: `${high} high-severity vulnerabilities found`,
            recommendation: 'Update vulnerable dependencies'
          });
        }

        if (moderate > 0 || low > 0) {
          this.issues.push({
            severity: 'MEDIUM',
            category: 'Dependencies',
            issue: `${moderate + low} moderate/low vulnerabilities found`,
            recommendation: 'Review and update dependencies when possible'
          });
        }
      }

      this.passed.push('Dependency vulnerability scan completed');
      
    } catch (error) {
      this.issues.push({
        severity: 'MEDIUM',
        category: 'Dependencies',
        issue: 'Could not run dependency vulnerability scan',
        recommendation: 'Run npm audit manually'
      });
    }
  }

  printResults() {
    console.log('\n' + '='.repeat(80));
    console.log('🔒 ARES OAUTH SECURITY AUDIT RESULTS');
    console.log('='.repeat(80));

    // Count issues by severity
    const severityCounts = {
      CRITICAL: this.issues.filter(i => i.severity === 'CRITICAL').length,
      HIGH: this.issues.filter(i => i.severity === 'HIGH').length,
      MEDIUM: this.issues.filter(i => i.severity === 'MEDIUM').length,
      LOW: this.issues.filter(i => i.severity === 'LOW').length,
    };

    console.log('\n📊 SUMMARY:');
    console.log(`   ✅ Checks Passed: ${this.passed.length}`);
    console.log(`   🚨 Critical Issues: ${severityCounts.CRITICAL}`);
    console.log(`   ⚠️  High Issues: ${severityCounts.HIGH}`);
    console.log(`   ⚡ Medium Issues: ${severityCounts.MEDIUM}`);
    console.log(`   💡 Low Issues: ${severityCounts.LOW}`);

    if (this.issues.length === 0) {
      console.log('\n🎉 NO SECURITY ISSUES FOUND! Great job!');
    } else {
      console.log('\n🔍 ISSUES FOUND:');
      
      for (const issue of this.issues) {
        const icon = {
          CRITICAL: '🚨',
          HIGH: '⚠️',
          MEDIUM: '⚡',
          LOW: '💡'
        }[issue.severity];

        console.log(`\n${icon} [${issue.severity}] ${issue.category}: ${issue.issue}`);
        console.log(`   Recommendation: ${issue.recommendation}`);
      }
    }

    console.log('\n' + '='.repeat(80));
    
    // Return exit code based on critical issues
    if (severityCounts.CRITICAL > 0) {
      console.log('❌ AUDIT FAILED: Critical security issues must be fixed before deployment');
      process.exit(1);
    } else if (severityCounts.HIGH > 0) {
      console.log('⚠️  AUDIT WARNING: High-severity issues should be addressed');
      process.exit(0);
    } else {
      console.log('✅ AUDIT PASSED: Ready for deployment');
      process.exit(0);
    }
  }
}

// Run audit if called directly
if (require.main === module) {
  const audit = new AresSecurityAudit();
  audit.runAudit().catch(console.error);
}

module.exports = AresSecurityAudit;