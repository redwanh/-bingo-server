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

// ============================================
// ADMIN ROUTES
// ============================================
router.post('/setup', protect, authorize('admin','superadmin'), ctrl.setupGame);
router.put('/prize', protect, authorize('admin','superadmin'), ctrl.setPrize);
router.post('/start', protect, authorize('admin','superadmin'), ctrl.startGame);
router.get('/monitor', protect, authorize('admin','superadmin'), ctrl.getMonitor);

// ============================================
// PLAYER ROUTES
// ============================================
router.get('/state', protect, ctrl.getState);
router.post('/buy', protect, ctrl.buyCards);
router.post('/pick', protect, ctrl.pickCards);
router.post('/topup', protect, ctrl.topupBalance);
router.post('/register-cards', protect, ctrl.registerCards);

// ============================================
// BINGO CALL (HTTP fallback)
// ============================================
router.post('/bingo', protect, async (req, res) => {
  try {
    const MainBingoGame = require('../models/MainBingoGame');
    const MainBingoRule = require('../models/MainBingoRule');
    const MainBingoConfig = require('../models/MainBingoConfig');
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
    
    const config = await MainBingoConfig.findById(game.configId);
    const mainBingoEngine = req.app.get('mainBingoEngine');
    const winType = await mainBingoEngine.checkWin(rule, card, game._id.toString(), config);
    
    if (!winType || hasInvalid) {
      card.isBlocked = true;
      card.blockReason = 'no_win';
      await card.save();
      const player = game.players.find(p => p.userId.toString() === req.user.id);
      if (player) player.blockedCards.push(req.body.cardId);
      await game.save();
      return res.json({ success: false, falseBingo: true, message: 'False Bingo!' });
    }
    
    // ✅ VALID BINGO
    card.bingoCalled = true;
    card.bingoCallTime = new Date();
    card.winType = winType;
    await card.save();
    
    const player = game.players.find(p => p.userId.toString() === req.user.id);
    if (player) player.calledBingo = true;
    
    const user = await User.findById(req.user.id).select('fullName phone');
    const io = req.app.get('io');
    
    if (game.status === 'in_progress') {
      // Stop drawing
      if (global.drawIntervals && global.drawIntervals[game._id.toString()]) {
        clearInterval(global.drawIntervals[game._id.toString()]);
        delete global.drawIntervals[game._id.toString()];
      }
      
      game.status = 'bingo_called';
      await game.save();
      
      io.to('main-bingo-room').emit('mainBingoFirstBingo', { 
        userId: req.user.id, cardId: req.body.cardId, 
        cardNumber: card.cardNumber, winType, winnerName: user.fullName
      });
      
      // Auto grace period after 3 seconds
      const graceSeconds = config?.gracePeriodSeconds || 10;
      
      setTimeout(async () => {
        const current = await MainBingoGame.findById(game._id);
        if (current && current.status === 'bingo_called') {
          current.status = 'grace_period';
          current.gracePeriodEndTime = new Date(Date.now() + graceSeconds * 1000);
          await current.save();
          
          io.to('main-bingo-room').emit('mainBingoGracePeriod', {
            seconds: graceSeconds,
            endTime: current.gracePeriodEndTime
          });
          
          setTimeout(async () => {
            const MainBingoEngine = require('../services/MainBingoEngine');
            const engine = new MainBingoEngine(io);
            await engine.endGracePeriod(game._id);
          }, graceSeconds * 1000);
        }
      }, 3000);
      
    } else {
      await game.save();
      io.to('main-bingo-room').emit('mainBingoAdditionalBingo', { 
        userId: req.user.id, cardId: req.body.cardId, 
        cardNumber: card.cardNumber, winType, winnerName: user.fullName
      });
    }
    
    res.json({ success: true, winType });
  } catch (e) { 
    res.status(400).json({ error: e.message }); 
  }
});

// ============================================
// CARD MANAGEMENT
// ============================================
router.get('/debug-cards', protect, async (req, res) => {
  try {
    const Card = require('../models/Card');
    const totalCards = await Card.countDocuments({});
    const poolCards = await Card.countDocuments({ gameId: null, userId: null });
    const assignedCards = await Card.countDocuments({ gameId: { $ne: null } });
    const userCards = await Card.countDocuments({ userId: { $ne: null } });
    const samplePool = await Card.find({ gameId: null, userId: null }).limit(3).select('displayId status cardId');
    const sampleAll = await Card.find({}).limit(5).select('displayId gameId userId status');
    const statusBreakdown = await Card.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]);
    
    res.json({ totalCards, poolCards, assignedCards, userCards, samplePool, sampleAll, statusBreakdown });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/cards/:id', protect, async (req, res) => {
  try {
    const Card = require('../models/Card');
    const MainBingoGame = require('../models/MainBingoGame');
    
    const card = await Card.findOne({ _id: req.params.id, userId: req.user.id, gameId: { $ne: null } });
    if (!card) return res.status(404).json({ error: 'Card not found' });
    
    card.gameId = null;
    card.userId = null;
    card.status = 'preview';
    card.isBlocked = false;
    card.blockReason = null;
    card.bingoCalled = false;
    card.cardNumber = null;
    await card.save();
    
    const game = await MainBingoGame.getActiveGame();
    if (game) {
      game.totalCards = Math.max(0, (game.totalCards || 0) - 1);
      const player = game.players?.find(p => p.userId.toString() === req.user.id);
      if (player) player.cards = player.cards.filter(c => c.toString() !== req.params.id);
      await game.save();
    }
    
    res.json({ success: true, message: 'Card returned to pool', displayId: card.displayId });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/cards/cancel', protect, async (req, res) => {
  try {
    const { cardIds } = req.body;
    const Card = require('../models/Card');
    const MainBingoGame = require('../models/MainBingoGame');
    
    if (!cardIds || !cardIds.length) return res.status(400).json({ error: 'No cards specified' });
    
    const result = await Card.updateMany(
      { _id: { $in: cardIds }, userId: req.user.id },
      { $set: { gameId: null, userId: null, status: 'preview', isBlocked: false, blockReason: null, bingoCalled: false, cardNumber: null } }
    );
    
    const game = await MainBingoGame.getActiveGame();
    if (game) {
      game.totalCards = Math.max(0, (game.totalCards || 0) - result.modifiedCount);
      const player = game.players?.find(p => p.userId.toString() === req.user.id);
      if (player) player.cards = player.cards.filter(c => !cardIds.includes(c.toString()));
      await game.save();
    }
    
    res.json({ success: true, resetCount: result.modifiedCount, message: `${result.modifiedCount} card(s) returned to pool` });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ============================================
// RESET CARDS (Admin)
// ============================================
router.post('/reset-cards', protect, authorize('admin','superadmin'), async (req, res) => {
  try {
    const { mode, gameId, force } = req.body;
    const Card = require('../models/Card');
    const User = require('../models/User');
    const MainBingoGame = require('../models/MainBingoGame');
    const CardGenerator = require('../services/cardGenerator');
    
    let game = null;
    if (gameId) game = await MainBingoGame.findById(gameId);
    if (!game) game = await MainBingoGame.findOne({ active: true });
    
    if (mode === 'full-reset') {
      const mongoose = require('mongoose');
      const collections = await mongoose.connection.db.listCollections().toArray();
      if (collections.some(c => c.name === 'cards')) {
        await mongoose.connection.db.dropCollection('cards');
      }
      await Card.createIndexes();
      
      const totalCards = 200;
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
      
      if (game) {
        game.totalCards = 0; game.playerCount = 0; game.prizeAmount = 0;
        game.calledNumbers = []; game.drawnNumbers = []; game.status = 'setup';
        await game.save();
      }
      await User.updateMany({}, { $set: { cards: [] } });
      
      return res.json({ success: true, message: `Full reset. Generated ${inserted} new cards.`, mode: 'full-reset', newCardsGenerated: inserted });
    }
    
    if (mode === 'delete' && force) {
      const deleteResult = await Card.deleteMany({});
      await User.updateMany({}, { $set: { cards: [] } });
      return res.json({ success: true, message: `Deleted ${deleteResult.deletedCount} cards`, mode: 'delete', affectedCards: deleteResult.deletedCount });
    }
    
    if (mode === 'clear' && force) {
      const clearResult = await Card.updateMany({}, {
        $set: { markedNumbers: [], isWinner: false, bingoCount: 0, lastMarkedAt: null, status: 'preview', gameId: null, userId: null, isBlocked: false, blockReason: null, bingoCalled: false, cardNumber: null, winType: null }
      });
      await User.updateMany({}, { $set: { cards: [] } });
      return res.json({ success: true, message: `Cleared ${clearResult.modifiedCount} cards`, mode: 'clear', affectedCards: clearResult.modifiedCount });
    }
    
    if (!game) return res.status(404).json({ error: 'No active game found. Use force mode or full-reset.' });
    if (game.status !== 'setup' && !force) return res.status(400).json({ error: 'Can only reset during setup. Current: ' + game.status });
    
    let result;
    if (mode === 'delete') {
      result = await Card.deleteMany({ gameId: game._id });
      await User.updateMany({ 'cards.gameId': game._id }, { $pull: { cards: { gameId: game._id } } });
    } else {
      result = await Card.updateMany({ gameId: game._id }, {
        $set: { markedNumbers: [], isWinner: false, bingoCount: 0, lastMarkedAt: null, status: 'preview', gameId: null, userId: null, isBlocked: false, blockReason: null, bingoCalled: false, cardNumber: null, winType: null }
      });
    }
    
    if (game) {
      game.totalCards = mode === 'delete' ? 0 : game.totalCards;
      game.playerCount = mode === 'delete' ? 0 : game.playerCount;
      game.prizeAmount = 0; game.calledNumbers = []; game.drawnNumbers = [];
      await game.save();
    }
    
    res.json({ success: true, message: mode === 'delete' ? `Deleted ${result.deletedCount || 0} cards` : `Cleared ${result.modifiedCount || 0} cards`, mode, affectedCards: mode === 'delete' ? result.deletedCount : result.modifiedCount });
    
  } catch (error) {
    res.status(500).json({ error: 'Failed to reset cards: ' + error.message });
  }
});

module.exports = router;