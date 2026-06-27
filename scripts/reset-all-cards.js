// server/scripts/reset-all-cards.js

require('dotenv').config();
const mongoose = require('mongoose');
const Card = require('../src/models/Card');  // 🔥 Fixed path

async function resetAllCards() {
  try {
    // Get MongoDB URI from environment or use default
    const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/bingo-platform';
    
    await mongoose.connect(MONGODB_URI);
    console.log('📦 Connected to MongoDB');

    // Get all cards
    const allCards = await Card.find({});
    console.log(`Found ${allCards.length} total cards`);

    let resetCount = 0;

    for (const card of allCards) {
      // Reset all cells in all columns
      const cols = ['B', 'I', 'N', 'G', 'O'];
      for (const col of cols) {
        if (card.grid && card.grid[col]) {
          card.grid[col] = card.grid[col].map(cell => ({
            number: cell.number,
            isMarked: cell.number === 0 ? true : false // Only FREE space (0) stays marked
          }));
        }
      }

      // Reset card to pool state
      card.gameId = null;
      card.userId = null;
      card.status = 'preview';
      card.isBlocked = false;
      card.blockReason = null;
      card.bingoCalled = false;
      card.bingoCallTime = null;
      card.bingoValidated = false;
      card.winType = null;

      await card.save();
      resetCount++;

      if (resetCount % 50 === 0) {
        console.log(`   Progress: ${resetCount}/${allCards.length}`);
      }
    }

    console.log(`✅ ${resetCount} cards reset to pool`);
    
    // Verify
    const poolCount = await Card.countDocuments({ gameId: null, status: 'preview' });
    const totalCount = await Card.countDocuments({});
    
    console.log(`📊 Total cards: ${totalCount}`);
    console.log(`📊 Pool cards: ${poolCount}`);
    console.log(`✅ Done!`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('📦 Disconnected from MongoDB');
    process.exit(0);
  }
}

resetAllCards();