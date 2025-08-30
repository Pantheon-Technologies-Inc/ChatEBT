#!/usr/bin/env node

// Script to fix the TTL index on the tokens collection
// This adds a 10-minute grace period to allow refresh attempts

const mongoose = require('mongoose');

async function fixTTLIndex() {
  try {
    // Connect to MongoDB using the same connection as the app
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/LibreChat';
    
    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    
    const db = mongoose.connection.db;
    const collection = db.collection('tokens');
    
    console.log('Dropping existing TTL index...');
    try {
      await collection.dropIndex('expiresAt_1');
      console.log('✓ Dropped existing TTL index');
    } catch (error) {
      if (error.message.includes('index not found')) {
        console.log('ℹ No existing TTL index to drop');
      } else {
        console.error('Warning: Error dropping index:', error.message);
      }
    }
    
    console.log('Creating new TTL index with 10-minute grace period...');
    await collection.createIndex(
      { expiresAt: 1 }, 
      { expireAfterSeconds: 600 }
    );
    console.log('✓ Created new TTL index with 600 second grace period');
    
    console.log('✓ TTL index fix completed successfully');
    
  } catch (error) {
    console.error('✗ Error fixing TTL index:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Load environment variables if .env file exists
if (require('fs').existsSync('.env')) {
  require('dotenv').config();
}

fixTTLIndex();