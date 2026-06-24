const express = require('express');
const router = express.Router();
const GameConfig = require('../models/GameConfig');
const Game = require('../models/Game');
const Card = require('../models/Card');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');

// ============================================
// GAME CONFIG
// ============================================

// Get room config
router.get('/config/:roomId', protect, async (req, res) => {
    const config = await GameConfig.findOne({ roomId: req.params.roomId });
    res.json(config || {});
});

// Update room config (admin only)
router.put('/config/:roomId', protect, authorize('admin', 'superadmin'), async (req, res) => {
    const config = await GameConfig.findOneAndUpdate(
        { roomId: req.params.roomId }, 
        req.body, 
        { new: true, upsert: true }
    );
    res.json({ success: true, config });
});

// ============================================
// GAME STATE
// ============================================

// Get game state
router.get('/state/:roomId', protect, async (req, res) => {
    try {
        const engine = req.app.get('gameEngine');
        const state = await engine.getGameState(req.params.roomId, req.user.id);
        res.json(state);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ============================================
// CARD PREVIEW (FIXED - ADD THIS)
// ============================================

// Preview a card (generate without buying)
router.post('/preview/:roomId', protect, async (req, res) => {
    try {
        const engine = req.app.get('gameEngine');
        const result = await engine.previewCard(req.params.roomId, req.user.id);
        res.json(result);
    } catch (e) {
        res.status(400).json({ success: false, error: e.message });
    }
});

// Get preview cards for a room
router.get('/:roomId/preview-cards', protect, async (req, res) => {
    try {
        const game = await Game.getActiveGame(req.params.roomId);
        if (!game) return res.json({ cards: [], message: 'No active game' });

        const previewCards = await Card.find({
            gameId: game._id,
            userId: req.user.id,
            status: 'preview'
        });

        res.json({ cards: previewCards, gameId: game._id });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Cancel a preview card
router.delete('/preview/:cardId', protect, async (req, res) => {
    try {
        const engine = req.app.get('gameEngine');
        const result = await engine.cancelPreviewCard(
            req.params.roomId || 'fast_bingo', 
            req.user.id, 
            req.params.cardId
        );
        res.json(result);
    } catch (e) {
        res.status(400).json({ success: false, error: e.message });
    }
});

// ============================================
// CARD REGISTRATION (FIXED - ADD THIS)
// ============================================

// Register a previewed card (actually buy it)
router.post('/register/:roomId', protect, async (req, res) => {
    try {
        const { cardId } = req.body;
        if (!cardId) {
            return res.status(400).json({ success: false, error: 'cardId is required' });
        }
        
        const engine = req.app.get('gameEngine');
        const result = await engine.registerCard(req.params.roomId, req.user.id, cardId);
        res.json(result);
    } catch (e) {
        res.status(400).json({ success: false, error: e.message });
    }
});

// ============================================
// BUY CARD (Direct purchase - existing)
// ============================================

// Buy card directly (without preview)
router.post('/buy/:roomId', protect, async (req, res) => {
    try {
        const engine = req.app.get('gameEngine');
        const result = await engine.buyCard(req.params.roomId, req.user.id);
        res.json(result);
    } catch (e) {
        res.status(400).json({ success: false, error: e.message });
    }
});

// ============================================
// BINGO CALL
// ============================================

// Call BINGO
router.post('/bingo/:roomId', protect, async (req, res) => {
    try {
        const engine = req.app.get('gameEngine');
        const result = await engine.callBingo(req.params.roomId, req.user.id, req.body.cardId);
        res.json(result);
    } catch (e) {
        res.status(400).json({ success: false, error: e.message });
    }
});

// ============================================
// MARK NUMBER
// ============================================

// Mark a number on a card
router.post('/mark', protect, async (req, res) => {
    try {
        const { cardId, number, letter } = req.body;
        const card = await Card.findOne({ _id: cardId, userId: req.user.id });
        
        if (!card || card.isBlocked) {
            return res.status(400).json({ error: 'Invalid card' });
        }
        
        const cell = card.grid[letter]?.find(c => c.number === number);
        if (cell) {
            cell.isMarked = !cell.isMarked;
            await card.save();
        }
        
        res.json({ success: true, grid: card.grid });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// ============================================
// GAME HISTORY
// ============================================

// Get game history
router.get('/history/:roomId', protect, async (req, res) => {
    try {
        const games = await Game.find({ 
            roomId: req.params.roomId, 
            status: 'completed' 
        })
        .sort({ endTime: -1 })
        .limit(20)
        .select('gameId gameNumber prizePool winners playerCount totalCards endTime');
        
        res.json(games);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ============================================
// TRANSACTIONS
// ============================================

// Get user transactions
router.get('/transactions', protect, async (req, res) => {
    try {
        const txns = await Transaction.find({ userId: req.user.id })
            .sort({ createdAt: -1 })
            .limit(50);
        res.json(txns);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ============================================
// ADMIN ENDPOINTS
// ============================================

// Force end game (admin only)
router.post('/admin/force-end/:roomId', protect, authorize('admin', 'superadmin'), async (req, res) => {
    try {
        const game = await Game.getActiveGame(req.params.roomId);
        if (!game) return res.status(404).json({ error: 'No active game' });

        game.status = 'completed';
        game.endTime = new Date();
        game.endReason = 'force_ended_by_admin';
        await game.save();

        const engine = req.app.get('gameEngine');

        // Clear draw timer
        const timerManager = require('../utils/TimerManager');
        timerManager.clearInterval("draw_" + req.params.roomId);
        timerManager.clearTimeout("grace_" + req.params.roomId);
        timerManager.clearInterval("poll_" + req.params.roomId);
        timerManager.clearTimeout("countdown_" + req.params.roomId);

        // Create new game
        const config = await GameConfig.findOne({ roomId: req.params.roomId });
        const lastNum = await Game.getLatestGameNumber(req.params.roomId);

        // Shuffle numbers
        const nums = [];
        for (let i = 1; i <= 75; i++) nums.push(i);
        for (let i = nums.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [nums[i], nums[j]] = [nums[j], nums[i]];
        }

        const newGame = await Game.create({
            gameId: String(lastNum + 1).padStart(10, '0'),
            gameNumber: lastNum + 1,
            roomId: req.params.roomId,
            status: 'scheduled',
            allNumbers: nums,
            timerDuration: config?.waitTimeSeconds || 30
        });

        engine.games.set(req.params.roomId, newGame);
        engine.io.to(req.params.roomId).emit('newGameCreated', {
            gameId: newGame.gameId,
            gameNumber: newGame.gameNumber,
            message: 'New game created by admin'
        });

        res.json({ 
            success: true, 
            message: 'Game force ended', 
            newGameId: newGame.gameId 
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Get all active games (admin)
router.get('/admin/active', protect, authorize('admin', 'superadmin'), async (req, res) => {
    try {
        const games = await Game.find({
            status: { $in: ['scheduled', 'waiting', 'in_progress', 'bingo_called'] }
        }).select('gameId gameNumber roomId status playerCount totalCards prizePool');
        
        res.json(games);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;