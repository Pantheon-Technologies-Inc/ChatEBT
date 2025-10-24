#!/usr/bin/env node
/**
 * Test script to verify Responses API implementation for file and web search
 * Run with: node test-responses-api.js
 */

require('dotenv').config();
const OpenAI = require('openai');

// Ensure DEBUG_OPENAI is enabled for testing
process.env.DEBUG_OPENAI = 'true';
process.env.USE_RESPONSES_API = 'true';

const logger = {
  info: (...args) => console.log('[TEST INFO]', ...args),
  error: (...args) => console.error('[TEST ERROR]', ...args),
  debug: (...args) => console.log('[TEST DEBUG]', ...args),
};

async function testWebSearch() {
  logger.info('='.repeat(50));
  logger.info('Testing Web Search with Responses API');
  logger.info('='.repeat(50));

  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const response = await openai.responses.create({
      model: 'gpt-4o',
      input: 'What are the latest news about artificial intelligence in 2025?',
      tools: [{ type: 'web_search' }],
      tool_choice: 'auto',
    });

    logger.info('Web Search Response Structure:', {
      hasOutput: !!response.output,
      outputTypes: response.output?.map(o => o?.type),
      usage: response.usage,
    });

    if (response.output) {
      response.output.forEach((item, index) => {
        logger.info(`Output item ${index}:`, {
          type: item.type,
          contentTypes: item.content?.map(c => c?.type),
        });
        if (item.type === 'message') {
          const textContent = item.content?.find(c => c?.type === 'output_text');
          if (textContent?.text) {
            logger.info('Response text preview:', textContent.text.substring(0, 200));
          }
        }
      });
    }

    logger.info('✅ Web Search test completed successfully');
  } catch (error) {
    logger.error('❌ Web Search test failed:', error.message);
    if (error.response) {
      logger.error('API Response:', error.response.data);
    }
  }
}

async function testFileSearch() {
  logger.info('='.repeat(50));
  logger.info('Testing File Search with Responses API');
  logger.info('='.repeat(50));

  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // First, create a test file and vector store
    logger.info('Creating test file and vector store...');

    // Create a vector store
    const vectorStore = await openai.vectorStores.create({
      name: 'test_responses_api_' + Date.now(),
    });
    logger.info('Created vector store:', vectorStore.id);

    // Create a test file with some content
    const testContent = `
# Test Document for Responses API

## Introduction
This is a test document to verify file search functionality with the Responses API.

## Key Information
- The secret code is: ALPHA-BRAVO-CHARLIE
- The test date is: ${new Date().toISOString()}
- The magic number is: 42

## Conclusion
This document contains test data for file search verification.
`;

    const fs = require('fs');
    const path = require('path');
    const tempFile = path.join(__dirname, 'test-file.md');
    fs.writeFileSync(tempFile, testContent);

    // Upload the file
    const file = await openai.files.create({
      file: fs.createReadStream(tempFile),
      purpose: 'assistants',
    });
    logger.info('Uploaded file:', file.id);

    // Add file to vector store
    await openai.vectorStores.files.create(vectorStore.id, {
      file_id: file.id,
    });
    logger.info('Added file to vector store');

    // Wait for processing
    logger.info('Waiting for vector store processing...');
    let ready = false;
    let attempts = 0;
    while (!ready && attempts < 20) {
      const files = await openai.vectorStores.files.list({ vector_store_id: vectorStore.id });
      ready = files.data.every(f => f.status === 'completed');
      if (!ready) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;
      }
    }
    logger.info('Vector store ready');

    // Test file search
    const response = await openai.responses.create({
      model: 'gpt-4o',
      input: 'What is the secret code in the document?',
      tools: [
        {
          type: 'file_search',
          vector_store_ids: [vectorStore.id],
        },
      ],
      include: ['file_search_call.results'],
    });

    logger.info('File Search Response Structure:', {
      hasOutput: !!response.output,
      outputTypes: response.output?.map(o => o?.type),
      usage: response.usage,
    });

    if (response.output) {
      response.output.forEach((item, index) => {
        logger.info(`Output item ${index}:`, {
          type: item.type,
          contentTypes: item.content?.map(c => c?.type),
        });
        if (item.type === 'message') {
          const textContent = item.content?.find(c => c?.type === 'output_text');
          if (textContent?.text) {
            logger.info('Response text:', textContent.text);
            if (textContent.text.includes('ALPHA-BRAVO-CHARLIE')) {
              logger.info('✅ File search correctly found the secret code!');
            }
          }
        }
        if (item.type === 'file_search_call') {
          logger.info('File search details:', {
            id: item.id,
            status: item.status,
            queries: item.queries,
          });
        }
      });
    }

    // Cleanup
    fs.unlinkSync(tempFile);
    logger.info('Cleaned up test file');

    logger.info('✅ File Search test completed successfully');
  } catch (error) {
    logger.error('❌ File Search test failed:', error.message);
    if (error.response) {
      logger.error('API Response:', error.response.data);
    }
  }
}

async function main() {
  logger.info('Starting Responses API Tests');
  logger.info('API Key present:', !!process.env.OPENAI_API_KEY);
  logger.info('USE_RESPONSES_API:', process.env.USE_RESPONSES_API);
  logger.info('');

  // Test web search
  await testWebSearch();
  logger.info('');

  // Test file search
  await testFileSearch();
  logger.info('');

  logger.info('All tests completed');
}

if (require.main === module) {
  main().catch(error => {
    logger.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { testWebSearch, testFileSearch };