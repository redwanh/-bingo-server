const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/mainBingoController');
const { protect, authorize } = require('../middleware/auth');

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







