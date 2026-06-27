// server/scripts/clean-game-players.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

async function cleanGamePlayers() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/bingo-platform';
  console.log('Connecting to:', uri.replace(/\/\/.*@/, '//***@')); // Hide credentials
  
  await mongoose.connect(uri);
  console.log('📦 Connected');

  // Find games in setup/countdown status
  const games = await mongoose.connection.db.collection('mainbingogames').find({
    status: { $in: ['setup', 'countdown'] }
  }).toArray();

  console.log(`Found ${games.length} active games`);

  for (const game of games) {
    // Count actual cards for each player
    const cards = await mongoose.connection.db.collection('cards').find({
      gameId: game._id.toString()
    }).toArray();

    // Group by userId
    const playerMap = {};
    cards.forEach(card => {
      if (card.userId) {
        const uid = card.userId.toString();
        if (!playerMap[uid]) playerMap[uid] = [];
        playerMap[uid].push(card._id.toString());
      }
    });

    // Rebuild players array
    const players = Object.entries(playerMap).map(([userId, cardIds]) => ({
      userId,
      cards: cardIds
    }));

    console.log(`  Game ${game.gameId}: ${players.length} players, ${cards.length} cards`);

    // Update game
    await mongoose.connection.db.collection('mainbingogames').updateOne(
      { _id: game._id },
      { $set: { players, totalCards: cards.length } }
    );
  }

  // Also release orphaned cards (cards assigned to completed games)
  const activeGameIds = games.map(g => g._id.toString());
  const orphanResult = await mongoose.connection.db.collection('cards').updateMany(
    { 
      gameId: { $nin: [...activeGameIds, null] },
      status: { $ne: 'preview' }
    },
    { 
      $set: { 
        gameId: null, 
        userId: null, 
        status: 'preview',
        isBlocked: false,
        bingoCalled: false
      } 
    }
  );
  console.log(`✅ ${orphanResult.modifiedCount} orphaned cards released to pool`);

  console.log('✅ Done');
  await mongoose.disconnect();
  process.exit(0);
}

cleanGamePlayers().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});