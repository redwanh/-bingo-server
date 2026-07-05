// 📁 server/check-cards.js

const mongoose = require('mongoose');
const Card = require('./src/models/Card');
require('dotenv').config();

async function checkCards() {
  console.log('🔍 Checking cards in database...');
  
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/bingo-platform', {
      socketTimeoutMS: 60000,
      serverSelectionTimeoutMS: 60000,
    });
    console.log('✅ Connected to MongoDB');

    const total = await Card.countDocuments();
    console.log(`📊 Total cards in database: ${total}`);

    const displayCards = await Card.countDocuments({
      displayId: { $gte: 10001, $lte: 10400 }
    });
    console.log(`📊 Cards with displayId 10001-10400: ${displayCards}`);

    if (displayCards > 0) {
      const sample = await Card.find({
        displayId: { $gte: 10001, $lte: 10400 }
      }).limit(5).sort({ displayId: 1 }).lean();
      
      console.log('\n📋 Sample cards:');
      sample.forEach(card => {
        console.log(`   - displayId: ${card.displayId}, status: ${card.status}`);
      });
    }

    try {
      const redis = require('./src/config/redis');
      const cached = await redis.get('master:cards:all');
      if (cached) {
        const parsed = JSON.parse(cached);
        console.log(`\n✅ Redis has ${parsed.length} cards cached`);
      } else {
        console.log('\n❌ Redis has NO cards cached');
      }
    } catch (error) {
      console.log('\n⚠️ Redis not available or not configured');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }

  process.exit(0);
}

checkCards();