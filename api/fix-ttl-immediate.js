#!/usr/bin/env node

// Immediate TTL fix - remove all TTL indexes and create regular index
require('dotenv').config();
require('module-alias')({ base: __dirname });

const { connectDb } = require('~/db');

async function fixTTLImmediate() {
  try {
    await connectDb();
    console.log('Connected to MongoDB');
    
    const mongoose = require('mongoose');
    const db = mongoose.connection.db;
    const collection = db.collection('tokens');

    console.log('Checking current indexes...');
    const indexes = await collection.indexes();
    
    console.log('Current indexes:');
    indexes.forEach((index, i) => {
      console.log(`${i + 1}. ${JSON.stringify(index.key)} - expireAfterSeconds: ${index.expireAfterSeconds}`);
    });

    // Drop ALL indexes on expiresAt field
    const indexesToDrop = indexes.filter(idx => 
      idx.name && (idx.name.includes('expiresAt') || (idx.key && idx.key.expiresAt))
    );

    for (const index of indexesToDrop) {
      try {
        console.log(`Dropping index: ${index.name}`);
        await collection.dropIndex(index.name);
        console.log(`✓ Dropped index: ${index.name}`);
      } catch (error) {
        console.log(`⚠️  Could not drop index ${index.name}: ${error.message}`);
      }
    }

    // Create new regular index (no TTL)
    console.log('Creating new regular expiresAt index...');
    await collection.createIndex({ expiresAt: 1 });
    console.log('✓ Created regular expiresAt index');

    // Verify final indexes
    console.log('\nFinal indexes:');
    const finalIndexes = await collection.indexes();
    finalIndexes.forEach((index, i) => {
      console.log(`${i + 1}. ${JSON.stringify(index.key)} - expireAfterSeconds: ${index.expireAfterSeconds || 'none'}`);
    });

    console.log('\n🎉 TTL index fix completed!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    process.exit(0);
  }
}

fixTTLImmediate();