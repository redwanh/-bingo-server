// ============================================================
// server/src/routes/FB_fastBingoRoutes.js
// Fast Bingo REST API - Admin config + Game state + History
// ============================================================

const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const Game = require('../models/FB_Game');
const GameConfig = require('../models/GameConfig');
const Card = require('../models/FB_Card');
const Transaction = require('../models/Transaction');
const User = require('../models/User');

// ══════════════════════════════════════
// MIDDLEWARE: Get FB engine
// ══════════════════════════════════════
const getEngine = (req) => req.app.get('fbEngine');

// ══════════════════════════════════════
// PUBLIC: Get game state
// ══════════════════════════════════════
router.get('/state', protect, async (req, res) => {
  try {
    const engine = getEngine(req);
    const state = await engine.getGameState('fb_fast_bingo', req.user.id);
    res.json(state);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ══════════════════════════════════════
// PUBLIC: Get card pool (400 cards)
// ══════════════════════════════════════
router.get('/cards/pool', protect, async (req, res) => {
  try {
    // Get ALL 400 cards regardless of game
    const cards = await Card.find({
      displayId: { $gte: 10001, $lte: 10400 }
    })
    .select('_id displayId status userId gameId grid isBlocked bingoCalled')
    .lean();

    // Get active game for status context
    const game = await Game.getActiveGame('fb_fast_bingo');

    // Format cards: show correct status based on whether they belong to active game
    const formattedCards = cards.map(card => {
      const belongsToActiveGame = game && card.gameId?.toString() === game._id.toString();
      
      return {
        _id: card._id,
        displayId: card.displayId,
        status: belongsToActiveGame ? card.status : 'available',
        userId: belongsToActiveGame ? card.userId : null,
        gameId: belongsToActiveGame ? card.gameId : null,
        grid: card.grid,
        isBlocked: belongsToActiveGame ? card.isBlocked : false,
        bingoCalled: belongsToActiveGame ? card.bingoCalled : false,
      };
    });

    console.log(`📦 FB: Returning ${formattedCards.length} cards | Available: ${formattedCards.filter(c => c.status === 'available').length}`);
    
    res.json({ cards: formattedCards });
  } catch (e) {
    console.error('FB: Card pool error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
// PUBLIC: Get player's cards
// ══════════════════════════════════════
router.get('/my-cards', protect, async (req, res) => {
  try {
    const game = await Game.getActiveGame('fb_fast_bingo');
    if (!game) return res.json({ cards: [] });

    const cards = await Card.find({
      gameId: game._id,
      userId: req.user.id,
      status: 'registered'
    }).lean();

    res.json({ cards });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
// PUBLIC: Get game history
// ══════════════════════════════════════
router.get('/history', protect, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const games = await Game.find({
      roomId: 'fb_fast_bingo',
      status: 'completed'
    })
    .sort({ endTime: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .select('gameId gameNumber prizePool winners playerCount totalCards endTime commission')
    .lean();

    const total = await Game.countDocuments({
      roomId: 'fb_fast_bingo',
      status: 'completed'
    });

    res.json({
      games,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
// PUBLIC: Get player transactions
// ══════════════════════════════════════
router.get('/transactions', protect, async (req, res) => {
  try {
    const transactions = await Transaction.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.json(transactions);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
// PUBLIC: Get player balance
// ══════════════════════════════════════
router.get('/balance', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('walletBalance').lean();
    res.json({ balance: user?.walletBalance || 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
// PUBLIC: Verify game integrity
// ══════════════════════════════════════
router.get('/verify', protect, async (req, res) => {
  try {
    const game = await Game.getActiveGame('fb_fast_bingo');
    if (!game) return res.json({ active: false });

    const totalCards = await Card.countDocuments({
      gameId: game._id,
      status: 'registered'
    });

    const totalPrize = await Card.aggregate([
      { $match: { gameId: game._id, status: 'registered' } },
      { $group: { _id: null, total: { $sum: '$price' } } }
    ]);

    const totalRefunds = await Transaction.aggregate([
      { $match: { gameId: game.gameId, type: 'refund' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    res.json({
      active: true,
      gameId: game.gameId,
      gameNumber: game.gameNumber,
      status: game.status,
      dbTotalCards: totalCards,
      gameTotalCards: game.totalCards,
      dbPrizePool: totalPrize[0]?.total || 0,
      gamePrizePool: game.prizePool,
      totalRefunds: totalRefunds[0]?.total || 0,
      playerCount: game.players.length,
      drawnCount: game.drawnNumbers?.length || 0
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
// ADMIN: Get config
// ══════════════════════════════════════
router.get('/admin/config', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const config = await GameConfig.findOne({ roomId: 'fb_fast_bingo' }).lean();
    res.json(config || {});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
// ADMIN: Update config
// ══════════════════════════════════════
router.put('/admin/config', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const engine = getEngine(req);
    const config = await engine.updateConfig('fb_fast_bingo', req.body);
    res.json({ success: true, config });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
// ADMIN: Get active game
// ══════════════════════════════════════
router.get('/admin/active', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const game = await Game.getActiveGame('fb_fast_bingo');
    if (!game) return res.json(null);

    const populated = await Game.findById(game._id)
      .populate('players.userId', 'username fullName phone walletBalance')
      .populate('winners.userId', 'username fullName phone')
      .lean();

    res.json(populated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
// ADMIN: Get game history (paginated)
// ══════════════════════════════════════
router.get('/admin/history', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;

    const games = await Game.find({
      roomId: 'fb_fast_bingo',
      status: 'completed'
    })
    .sort({ endTime: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .populate('winners.userId', 'username fullName phone')
    .lean();

    const total = await Game.countDocuments({
      roomId: 'fb_fast_bingo',
      status: 'completed'
    });

    res.json({
      games,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
// ADMIN: Force end game (emergency)
// ══════════════════════════════════════
router.post('/admin/force-end', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const engine = getEngine(req);
    const game = await Game.getActiveGame('fb_fast_bingo');

    if (!game) return res.status(404).json({ error: 'No active game' });

    await engine.endGracePeriod('fb_fast_bingo', game._id);
    res.json({ success: true, message: 'Game ended' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
// ADMIN: Refund all (emergency)
// ══════════════════════════════════════
router.post('/admin/refund-all', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const engine = getEngine(req);
    const game = await Game.getActiveGame('fb_fast_bingo');

    if (!game) return res.status(404).json({ error: 'No active game' });

    await engine.endGameNoWinner('fb_fast_bingo', game);
    res.json({ success: true, message: 'All cards refunded' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;