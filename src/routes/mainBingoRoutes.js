const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/mainBingoController');
const { protect, authorize } = require('../middleware/auth');

// Handle preflight for APK
router.options('*', (req, res) => {
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.sendStatus(200);
});

router.post('/setup', protect, authorize('admin','superadmin'), ctrl.setupGame);

router.post('/setup', protect, authorize('admin','superadmin'), ctrl.setupGame);
router.put('/prize', protect, authorize('admin','superadmin'), ctrl.setPrize);
router.post('/start', protect, authorize('admin','superadmin'), ctrl.startGame);
router.get('/monitor', protect, authorize('admin','superadmin'), ctrl.getMonitor);
router.get('/state', protect, ctrl.getState);
router.post('/buy', protect, ctrl.buyCards);
router.post('/pick', protect, ctrl.pickCards); 
router.post('/topup', protect, ctrl.topupBalance);
// server/routes/mainBingo.js
router.post('/register-cards', protect, ctrl.registerCards);
// BINGO call
router.post('/bingo', protect, async (req, res) => {
  try {
    const MainBingoGame = require('../models/MainBingoGame');
    const MainBingoRule = require('../models/MainBingoRule');
    const Card = require('../models/Card');
    const User = require('../models/User');
    
    const game = await MainBingoGame.getActiveGame();
    if (!game || (game.status !== 'in_progress' && game.status !== 'bingo_called')) {
      return res.status(400).json({ error: 'Game not in progress' });
    }
    
    const card = await Card.findOne({ _id: req.body.cardId, userId: req.user.id, gameId: game._id });
    if (!card) return res.status(400).json({ error: 'Card not found' });
    if (card.isBlocked) return res.status(400).json({ error: 'Card blocked' });
    if (card.bingoCalled) return res.status(400).json({ error: 'Already called' });
    
    const rule = await MainBingoRule.findById(game.ruleId);
    if (!rule) return res.status(400).json({ error: 'Rule not found' });
    
    // Check for marked uncalled numbers
    const drawnSet = new Set(game.drawnNumbers.map(d => d.number));
    let hasInvalid = false;
    for (let c of ['B','I','N','G','O']) {
      for (let cell of card.grid[c]) {
        if (cell.isMarked && cell.number > 0 && !drawnSet.has(cell.number)) {
          hasInvalid = true; break;
        }
      }
    }
    
    const winType = validateMainBingoWin(rule, card);
    
    if (!winType || hasInvalid) {
      card.isBlocked = true;
      card.blockReason = 'no_win';
      await card.save();
      const player = game.players.find(p => p.userId.toString() === req.user.id);
      if (player) player.blockedCards.push(req.body.cardId);
      await game.save();
      return res.json({ success: false, falseBingo: true, message: 'False Bingo!' });
    }
    
    card.bingoCalled = true;
    card.bingoCallTime = new Date();
    card.winType = winType;
    await card.save();
    
    const player = game.players.find(p => p.userId.toString() === req.user.id);
    if (player) player.calledBingo = true;
    
    const user = await User.findById(req.user.id).select('fullName phone');
    const io = req.app.get('io');
    
    if (game.status === 'in_progress') {
      game.status = 'bingo_called';
      game.gracePeriodEndTime = new Date(Date.now() + 20000);
      await game.save();
      if (io) io.emit('mainBingoFirstBingo', { userId: req.user.id, cardId: req.body.cardId, cardNumber: card.cardNumber, winType, winnerName: user.fullName, winnerPhone: user.phone, cardGrid: card.grid });
    } else {
      await game.save();
      if (io) io.emit('mainBingoAdditionalBingo', { userId: req.user.id, cardId: req.body.cardId, cardNumber: card.cardNumber, winType, winnerName: user.fullName, winnerPhone: user.phone, cardGrid: card.grid });
    }
    
    res.json({ success: true, winType });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
// server/routes/mainBingo.js
router.get('/debug-cards', protect, async (req, res) => {
  try {
    const Card = require('../models/Card');
    
    // Total cards in DB
    const totalCards = await Card.countDocuments({});
    
    // Pool cards (not assigned)
    const poolCards = await Card.countDocuments({ gameId: null, userId: null });
    
    // Cards with gameId set
    const assignedCards = await Card.countDocuments({ gameId: { $ne: null } });
    
    // Cards with userId set
    const userCards = await Card.countDocuments({ userId: { $ne: null } });
    
    // Sample pool cards
    const samplePool = await Card.find({ gameId: null, userId: null }).limit(3).select('displayId status cardId');
    
    // Sample all cards
    const sampleAll = await Card.find({}).limit(5).select('displayId gameId userId status');
    
    // Status breakdown
    const statusBreakdown = await Card.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]);
    
    res.json({
      totalCards,
      poolCards,
      assignedCards,
      userCards,
      samplePool,
      sampleAll,
      statusBreakdown
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// Add this at the end of the file (before module.exports = router)

// Reset Cards - Clear/Delete/Full Reset (Admin only - Debug/Test)
// Reset Cards - Clear/Delete/Full Reset (Admin only - Debug/Test)
router.post('/reset-cards', protect, authorize('admin','superadmin'), async (req, res) => {
  try {
    const { mode, gameId, force } = req.body;
    const Card = require('../models/Card');
    const User = require('../models/User');
    const MainBingoGame = require('../models/MainBingoGame');
    const CardGenerator = require('../services/cardGenerator');
    
    let game = null;
    
    // If gameId provided, try to find it
    if (gameId) {
      game = await MainBingoGame.findById(gameId);
    }
    
    // If no game found, try active game
    if (!game) {
      game = await MainBingoGame.findOne({ active: true });
    }
    
    // For full reset mode - Drop and recreate
    if (mode === 'full-reset') {
      const mongoose = require('mongoose');
      const collections = await mongoose.connection.db.listCollections().toArray();
      const cardsCollectionExists = collections.some(c => c.name === 'cards');
      
      if (cardsCollectionExists) {
        await mongoose.connection.db.dropCollection('cards');
        console.log('✅ Dropped cards collection');
      }
      
      // Recreate indexes
      await Card.createIndexes();
      console.log('✅ Recreated card indexes');
      
      // Generate fresh cards using CardGenerator
      const totalCards = 200; // Number of cards to generate (adjust as needed)
      console.log(`🔄 Generating ${totalCards} new cards using CardGenerator...`);
      
      const BATCH = 500;
      const batches = Math.ceil(totalCards / BATCH);
      let inserted = 0;
      
      for (let b = 0; b < batches; b++) {
        const cards = [];
        const start = b * BATCH + 1;
        const end = Math.min((b + 1) * BATCH, totalCards);
        
        for (let i = start; i <= end; i++) {
          const card = CardGenerator.generateCard(i);
          card.displayId = 10000 + i - 1; // Start from 10000 like your seeder
          card.status = 'preview'; // Set initial status
          card.gameId = null;
          card.userId = null;
          cards.push(card);
        }
        
        await Card.insertMany(cards, { ordered: false });
        inserted += cards.length;
      }
      
      console.log(`✅ Generated ${inserted} new cards`);
      
      // Reset game if exists
      if (game) {
        game.totalCards = 0;
        game.playerCount = 0;
        game.prizeAmount = 0;
        game.calledNumbers = [];
        game.drawnNumbers = [];
        game.status = 'setup';
        await game.save();
      }
      
      // Clear all user card references
      await User.updateMany({}, { $set: { cards: [] } });
      
      return res.json({
        success: true,
        message: `Full database reset completed. Generated ${inserted} new cards.`,
        mode: 'full-reset',
        affectedCards: 0,
        newCardsGenerated: inserted
      });
    }
    
    // For delete mode with force (no game needed)
    if (mode === 'delete' && force) {
      const deleteResult = await Card.deleteMany({});
      await User.updateMany({}, { $set: { cards: [] } });
      
      // Generate new cards after deletion
      const totalCards = 100;
      console.log(`🔄 Generating ${totalCards} new cards after deletion...`);
      
      const BATCH = 500;
      const batches = Math.ceil(totalCards / BATCH);
      let inserted = 0;
      
      for (let b = 0; b < batches; b++) {
        const cards = [];
        const start = b * BATCH + 1;
        const end = Math.min((b + 1) * BATCH, totalCards);
        
        for (let i = start; i <= end; i++) {
          const card = CardGenerator.generateCard(i);
          card.displayId = 10000 + i - 1;
          card.status = 'preview';
          card.gameId = null;
          card.userId = null;
          cards.push(card);
        }
        
        await Card.insertMany(cards, { ordered: false });
        inserted += cards.length;
      }
      
      return res.json({
        success: true,
        message: `Deleted ${deleteResult.deletedCount} cards and generated ${inserted} new cards`,
        mode: 'delete',
        affectedCards: deleteResult.deletedCount,
        newCardsGenerated: inserted
      });
    }
    
    // For clear mode with force
    if (mode === 'clear' && force) {
      const clearResult = await Card.updateMany({}, {
        $set: {
          markedNumbers: [],
          isWinner: false,
          bingoCount: 0,
          lastMarkedAt: null,
          status: 'preview',
          gameId: null,
          userId: null,
          isBlocked: false,
          blockReason: null,
          bingoCalled: false,
          cardNumber: null,
          winType: null
        }
      });
      
      await User.updateMany({}, { $set: { cards: [] } });
      
      return res.json({
        success: true,
        message: `Cleared ${clearResult.modifiedCount} cards back to pool`,
        mode: 'clear',
        affectedCards: clearResult.modifiedCount,
        newCardsGenerated: 0
      });
    }
    
    if (!game) {
      return res.status(404).json({ error: 'No active game found. Use force mode or full-reset.' });
    }
    
    if (game.status !== 'setup' && !force) {
      return res.status(400).json({ 
        error: 'Can only reset cards during setup phase. Current status: ' + game.status 
      });
    }
    
    let result;
    
    if (mode === 'delete') {
      result = await Card.deleteMany({ gameId: game._id });
      
      await User.updateMany(
        { 'cards.gameId': game._id },
        { $pull: { cards: { gameId: game._id } } }
      );
      
      console.log(`Deleted ${result.deletedCount} cards`);
    } else {
      result = await Card.updateMany(
        { gameId: game._id },
        {
          $set: {
            markedNumbers: [],
            isWinner: false,
            bingoCount: 0,
            lastMarkedAt: null,
            status: 'preview',
            gameId: null,
            userId: null,
            isBlocked: false,
            blockReason: null,
            bingoCalled: false,
            cardNumber: null,
            winType: null
          }
        }
      );
      
      console.log(`Cleared ${result.modifiedCount} cards`);
    }
    
    // Reset game stats
    if (game) {
      game.totalCards = mode === 'delete' ? 0 : game.totalCards;
      game.playerCount = mode === 'delete' ? 0 : game.playerCount;
      game.prizeAmount = 0;
      game.calledNumbers = [];
      game.drawnNumbers = [];
      await game.save();
    }
    
    res.json({
      success: true,
      message: mode === 'delete' 
        ? `Deleted ${result.deletedCount || 0} cards` 
        : `Cleared ${result.modifiedCount || 0} cards back to pool`,
      mode: mode,
      affectedCards: mode === 'delete' ? result.deletedCount : result.modifiedCount,
      newCardsGenerated: 0
    });
    
  } catch (error) {
    console.error('Reset cards error:', error);
    res.status(500).json({ error: 'Failed to reset cards: ' + error.message });
  }
});

// DELETE /api/main-bingo/cards/:id
// server/routes/mainBingo.js

// DELETE /api/main-bingo/cards/:id - Reset card to pool
router.delete('/cards/:id', protect, async (req, res) => {
  try {
    const Card = require('../models/Card');
    const MainBingoGame = require('../models/MainBingoGame');
    
    const card = await Card.findOne({ 
      _id: req.params.id, 
      userId: req.user.id,
      gameId: { $ne: null }
    });
    
    if (!card) {
      return res.status(404).json({ error: 'Card not found' });
    }
    
    // 🔥 Reset card back to pool (don't delete)
    card.gameId = null;
    card.userId = null;
    card.status = 'preview';
    card.isBlocked = false;
    card.blockReason = null;
    card.bingoCalled = false;
    card.cardNumber = null;
    await card.save();
    
    // Update game
    const game = await MainBingoGame.getActiveGame();
    if (game) {
      game.totalCards = Math.max(0, (game.totalCards || 0) - 1);
      const player = game.players?.find(p => p.userId.toString() === req.user.id);
      if (player) {
        player.cards = player.cards.filter(c => c.toString() !== req.params.id);
      }
      await game.save();
    }
    
    console.log('🔄 Card reset to pool:', card.displayId);
    
    res.json({ 
      success: true, 
      message: 'Card returned to pool',
      displayId: card.displayId
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/main-bingo/cards/cancel - Bulk reset cards
router.post('/cards/cancel', protect, async (req, res) => {
  try {
    const { cardIds } = req.body;
    const Card = require('../models/Card');
    const MainBingoGame = require('../models/MainBingoGame');
    
    if (!cardIds || !cardIds.length) {
      return res.status(400).json({ error: 'No cards specified' });
    }
    
    // 🔥 Reset cards back to pool
    const result = await Card.updateMany(
      { 
        _id: { $in: cardIds }, 
        userId: req.user.id 
      },
      { 
        $set: { 
          gameId: null,
          userId: null,
          status: 'preview',
          isBlocked: false,
          blockReason: null,
          bingoCalled: false,
          cardNumber: null
        } 
      }
    );
    
    // Update game
    const game = await MainBingoGame.getActiveGame();
    if (game) {
      game.totalCards = Math.max(0, (game.totalCards || 0) - result.modifiedCount);
      const player = game.players?.find(p => p.userId.toString() === req.user.id);
      if (player) {
        player.cards = player.cards.filter(c => !cardIds.includes(c.toString()));
      }
      await game.save();
    }
    
    console.log('🔄 Bulk reset:', result.modifiedCount, 'cards');
    
    res.json({ 
      success: true, 
      resetCount: result.modifiedCount,
      message: `${result.modifiedCount} card(s) returned to pool` 
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

function validateMainBingoWin(rule, card) {
  const COLS = ['B','I','N','G','O'];
  
  if (rule.method === 'pattern') {
    for (const pattern of rule.patterns) {
      if (pattern.cells.every(([row, col]) => {
        if (col === 2 && row === 2 && rule.ruleConfig?.freeSpaceCounts) return true;
        return card.grid[COLS[col]][row].isMarked;
      })) return 'pattern';
    }
    return null;
  }
  
  const cfg = rule.ruleConfig || {};
  let rows = 0, cols = 0, diags = 0;
  
  for (let r = 0; r < 5; r++) {
    let ok = true;
    for (let c = 0; c < 5; c++) {
      if (c === 2 && r === 2 && cfg.freeSpaceCounts) continue;
      if (!card.grid[COLS[c]][r].isMarked) { ok = false; break; }
    }
    if (ok) rows++;
  }
  for (let c = 0; c < 5; c++) {
    let ok = true;
    for (let r = 0; r < 5; r++) {
      if (c === 2 && r === 2 && cfg.freeSpaceCounts) continue;
      if (!card.grid[COLS[c]][r].isMarked) { ok = false; break; }
    }
    if (ok) cols++;
  }
  let d1 = true, d2 = true;
  for (let i = 0; i < 5; i++) {
    if (!(i === 2 && cfg.freeSpaceCounts) && !card.grid[COLS[i]][i].isMarked) d1 = false;
    if (!(i === 2 && cfg.freeSpaceCounts) && !card.grid[COLS[4-i]][i].isMarked) d2 = false;
  }
  if (d1) diags++; if (d2) diags++;
  const total = rows + cols + diags;
  if (total >= (cfg.linesToWin || 3) && rows >= (cfg.minRows || 0) && cols >= (cfg.minColumns || 0) && diags >= (cfg.minDiagonals || 0)) return 'rule_win';
  return null;
}

module.exports = router;







