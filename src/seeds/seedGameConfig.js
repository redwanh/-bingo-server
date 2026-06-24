const mongoose = require('mongoose');
const GameConfig = require('../models/GameConfig');
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  await GameConfig.findOneAndUpdate(
    { roomId: 'fast_bingo' },
    {
      roomId: 'fast_bingo',
      name: 'Fast Bingo',
      cardPrice: 10,
      maxCardsPerPlayer: 5,
      minPlayersToStart: 1,
      commissionPercentage: 10,
      waitTimeSeconds: 30,
      drawIntervalSeconds: 5,
      resetOnNoPlayers: true,
      isActive: true
    },
    { upsert: true, new: true }
  );
  
  console.log('Game config created for fast_bingo!');
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });