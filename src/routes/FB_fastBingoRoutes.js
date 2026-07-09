// ============================================================
// server/src/routes/FB_fastBingoRoutes.js
// ============================================================

const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const Game = require('../models/FB_Game');
const GameConfig = require('../models/GameConfig');
const Card = require('../models/FB_Card');
const Transaction = require('../models/Transaction');
const User = require('../models/User');

const VALID_ROOMS = ['fb_fast_bingo_10', 'fb_fast_bingo_20', 'fb_fast_bingo_30'];
const DEFAULT_ROOM = 'fb_fast_bingo_10';

// 🔥 Helper: Get display range from roomId
function getDisplayRange(roomId) {
  if (roomId.includes('_20')) return { min: 20001, max: 20400 };
  if (roomId.includes('_30')) return { min: 30001, max: 30400 };
  return { min: 10001, max: 10400 }; // default 10 Birr
}

// 🔥 Helper: Get roomId from query or default
function getRoomId(req) {
  const roomId = req.query.roomId || req.body.roomId || DEFAULT_ROOM;
  return VALID_ROOMS.includes(roomId) ? roomId : DEFAULT_ROOM;
}

const getEngine = (req) => req.app.get('fbEngine');

// ══════════════════════════════════════
// PUBLIC: Get game state (dynamic room)
// ══════════════════════════════════════
router.get('/state', protect, async (req, res) => {
  try {
    const engine = getEngine(req);
    const roomId = getRoomId(req);
    const state = await engine.getGameState(roomId, req.user.id);
    res.json(state);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
// PUBLIC: Get card pool (per room)
// ══════════════════════════════════════
router.get('/cards/pool', protect, async (req, res) => {
  try {
    const roomId = getRoomId(req);
    const range = getDisplayRange(roomId);

    const cards = await Card.find({
      displayId: { $gte: range.min, $lte: range.max }
    })
    .select('_id displayId status userId gameId grid isBlocked bingoCalled')
    .lean();

    const game = await Game.getActiveGame(roomId);

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

    res.json({ cards: formattedCards });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
// PUBLIC: Get player's cards (dynamic room)
// ══════════════════════════════════════
router.get('/my-cards', protect, async (req, res) => {
  try {
    const roomId = getRoomId(req);
    const game = await Game.getActiveGame(roomId);
    if (!game) return res.json({ cards: [] });

    const cards = await Card.find({
      gameId: game._id, userId: req.user.id, status: 'registered'
    }).lean();

    res.json({ cards });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
// PUBLIC: Get game history (dynamic room)
// ══════════════════════════════════════
router.get('/history', protect, async (req, res) => {
  try {
    const roomId = getRoomId(req);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const games = await Game.find({ roomId, status: 'completed' })
      .sort({ endTime: -1 }).skip((page - 1) * limit).limit(limit)
      .select('gameId gameNumber prizePool winners playerCount totalCards endTime commission')
      .lean();

    const total = await Game.countDocuments({ roomId, status: 'completed' });

    res.json({ games, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
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
      .sort({ createdAt: -1 }).limit(50).lean();
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
    const roomId = getRoomId(req);
    const game = await Game.getActiveGame(roomId);
    if (!game) return res.json({ active: false });

    const totalCards = await Card.countDocuments({ gameId: game._id, status: 'registered' });
    const totalPrize = await Card.aggregate([
      { $match: { gameId: game._id, status: 'registered' } },
      { $group: { _id: null, total: { $sum: '$price' } } }
    ]);

    res.json({
      active: true, gameId: game.gameId, gameNumber: game.gameNumber,
      status: game.status, dbTotalCards: totalCards, gameTotalCards: game.totalCards,
      dbPrizePool: totalPrize[0]?.total || 0, gamePrizePool: game.prizePool,
      playerCount: game.players.length, drawnCount: game.drawnNumbers?.length || 0
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
// ADMIN: Get config (dynamic room)
// ══════════════════════════════════════
router.get('/admin/config', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const roomId = getRoomId(req);
    const config = await GameConfig.findOne({ roomId }).lean();
    res.json(config || {});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
// ADMIN: Update config (dynamic room)
// ══════════════════════════════════════
router.put('/admin/config', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const engine = getEngine(req);
    const roomId = getRoomId(req);
    const config = await engine.updateConfig(roomId, req.body);
    res.json({ success: true, config });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
// ADMIN: Get active game (dynamic room)
// ══════════════════════════════════════
router.get('/admin/active', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const roomId = getRoomId(req);
    const game = await Game.getActiveGame(roomId);
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
// ADMIN: Get game history (dynamic room)
// ══════════════════════════════════════
router.get('/admin/history', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const roomId = getRoomId(req);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;

    const games = await Game.find({ roomId, status: 'completed' })
      .sort({ endTime: -1 }).skip((page - 1) * limit).limit(limit)
      .populate('winners.userId', 'username fullName phone').lean();

    const total = await Game.countDocuments({ roomId, status: 'completed' });

    res.json({ games, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
// ADMIN: Force end game (dynamic room)
// ══════════════════════════════════════
router.post('/admin/force-end', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const engine = getEngine(req);
    const roomId = getRoomId(req);
    const game = await Game.getActiveGame(roomId);
    if (!game) return res.status(404).json({ error: 'No active game' });
    await engine.endGracePeriod(roomId, game._id);
    res.json({ success: true, message: 'Game ended' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
// ADMIN: Refund all (dynamic room)
// ══════════════════════════════════════
router.post('/admin/refund-all', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const engine = getEngine(req);
    const roomId = getRoomId(req);
    const game = await Game.getActiveGame(roomId);
    if (!game) return res.status(404).json({ error: 'No active game' });
    await engine.endGameNoWinner(roomId, game);
    res.json({ success: true, message: 'All cards refunded' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;