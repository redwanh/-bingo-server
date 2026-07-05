const Card = require('./Card');
const MainBingoGame = require('./MainBingoGame');

async function createIndexes() {
  try {
    // Card indexes - faster lookups
    await Card.collection.createIndex({ gameId: 1, userId: 1 });
    await Card.collection.createIndex({ gameId: 1, status: 1 });
    // Pool cards index (only status needed, gameId/userId are null for pool)
    await Card.collection.createIndex({ status: 1 });
    
    // Game indexes
    await MainBingoGame.collection.createIndex({ status: 1, createdAt: -1 });
    
    console.log('✅ Database indexes created');
  } catch (e) {
    // Ignore "index already exists" errors
    if (e.code !== 85 && e.code !== 86) {
      console.error('Index error:', e.message);
    }
  }
}

module.exports = createIndexes;