const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load env
dotenv.config({ path: path.join(__dirname, '.env') });

// Use the same MongoDB URI from your .env
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/bingo';

// Models — try multiple possible paths
let Game, GameConfig, Card, User;

try { Game = require('./src/models/Game'); } catch { }
try { GameConfig = require('./src/models/GameConfig'); } catch { }
try { Card = require('./src/models/Card'); } catch { }
try { User = require('./src/models/User'); } catch { }

// If first try fails, search for models
if (!Game) {
  try { Game = require('./models/Game'); } catch { }
}
if (!GameConfig) {
  try { GameConfig = require('./models/GameConfig'); } catch { }
}
if (!Card) {
  try { Card = require('./models/Card'); } catch { }
}
if (!User) {
  try { User = require('./models/User'); } catch { }
}

async function fixStuckGame(roomId) {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    // Find stuck games
    const stuckGames = await Game.find({
      status: { $in: ['bingo_called', 'grace_period'] }
    }).lean();
    
    console.log(`Found ${stuckGames.length} stuck games`);
    
    for (const game of stuckGames) {
      console.log(`Fixing game: ${game._id} (status: ${game.status})`);
      
      // Mark as completed
      await Game.updateOne(
        { _id: game._id },
        { $set: { status: 'completed', endTime: new Date(), endReason: 'fixed_by_script' } }
      );
    }
    
    // Reset all cards
    if (Card) {
      const resetResult = await Card.updateMany(
        { displayId: { $gte: 10001, $lte: 10400 } },
        { 
          $set: { 
            status: 'available', 
            userId: null, 
            gameId: null, 
            isBlocked: false,
            bingoCalled: false,
            bingoValidated: false,
            winType: null,
            reservedBy: null,
            reservedAt: null,
            registeredAt: null
          } 
        }
      );
      console.log(`Reset ${resetResult.modifiedCount} cards`);
    }
    
    // Create new game
    const conf = await GameConfig.findOne({ roomId }).lean();
    if (!conf) {
      console.log('⚠️ No config found for room:', roomId);
      // Create default config
      await GameConfig.create({
        roomId,
        roomName: 'Fast Bingo',
        cardPrice: 50,
        maxCardsPerPlayer: 5,
        minPlayersToStart: 2,
        waitTimeSeconds: 30,
        drawIntervalSeconds: 5,
        commissionPercentage: 10,
        gracePeriodSeconds: 10,
      });
      console.log('✅ Created default config');
    }
    
    const latestGame = await Game.findOne({ roomId }).sort({ gameNumber: -1 }).lean();
    const nextNumber = (latestGame?.gameNumber || 0) + 1;
    
    // Shuffle numbers
    const nums = [];
    for (let i = 1; i <= 75; i++) nums.push(i);
    for (let i = nums.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [nums[i], nums[j]] = [nums[j], nums[i]];
    }
    
    const newGame = await Game.create({
      gameId: String(nextNumber).padStart(10, '0'),
      gameNumber: nextNumber,
      roomId,
      status: 'scheduled',
      allNumbers: nums,
      timerDuration: conf?.waitTimeSeconds || 30,
    });
    
    console.log('✅ New game created:', newGame.gameId, '(Game #' + newGame.gameNumber + ')');
    
    await mongoose.disconnect();
    console.log('✅ Done!');
    process.exit(0);
  } catch (error) {
    console.error('🔴 Error:', error);
    process.exit(1);
  }
}

fixStuckGame('fast_bingo');