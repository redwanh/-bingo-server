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

// Get user's game history with winning cards and grouped by game
router.get('/history/user/all', protect, async (req, res) => {
    try {
        const games = await Game.find({ 
            'players.userId': req.user.id,
            status: 'completed' 
        })
        .sort({ endTime: -1 })
        .limit(50)
        .select('gameId gameNumber roomId prizePool winners playerCount totalCards endTime startTime drawnNumbers');
        
        // Get all user's cards for these games
        const gameIds = games.map(g => g._id);
        const userCards = await Card.find({
            gameId: { $in: gameIds },
            userId: req.user.id
        }).select('gameId cardNumber bingoCalled winType price grid');
        
        // Group cards by game
        const cardsByGame = {};
        userCards.forEach(card => {
            const gid = card.gameId.toString();
            if (!cardsByGame[gid]) cardsByGame[gid] = [];
            cardsByGame[gid].push(card);
        });
        
        // Enrich games with user data
        const enriched = games.map(game => {
            const gid = game._id.toString();
            const myCards = cardsByGame[gid] || [];
            const winningCards = myCards.filter(c => c.bingoCalled);
            const isWinner = winningCards.length > 0;
            
            return {
                gameId: game.gameId,
                gameNumber: game.gameNumber,
                roomId: game.roomId,
                startTime: game.startTime,
                endTime: game.endTime,
                totalCards: game.totalCards,
                playerCount: game.playerCount,
                numbersCalled: game.drawnNumbers?.length || 0,
                totalNumbers: 75,
                myCardsCount: myCards.length,
                isWinner,
                prizeWon: isWinner ? (game.winners?.find(w => w.userId?.toString() === req.user.id)?.prizeAmount || 0) : 0,
                prizePool: game.prizePool,
                winningCards: winningCards.map(c => ({
                    cardNumber: c.cardNumber,
                    winType: c.winType,
                    grid: c.grid,
                    price: c.price,
                })),
                allMyCards: myCards.map(c => ({
                    cardNumber: c.cardNumber,
                    bingoCalled: c.bingoCalled,
                    price: c.price,
                })),
            };
        });
        
        res.json({ success: true, games: enriched });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

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

// routes/mainBingo.js

// POST /api/main-bingo/reset-cards
router.post('/reset-cards', protect, authorize('admin'), async (req, res) => {
  try {
    const { mode, gameId, force } = req.body;
    
    let game = null;
    
    // If gameId provided, try to find it
    if (gameId) {
      game = await MainBingo.findById(gameId);
    }
    
    // If no game found, try active game
    if (!game) {
      game = await MainBingo.findOne({ active: true });
    }
    
    // For full reset mode, we don't need a game
    if (mode === 'full-reset') {
      // Drop the entire cards collection and recreate indexes
      const collections = await mongoose.connection.db.listCollections().toArray();
      const cardsCollectionExists = collections.some(c => c.name === 'cards');
      
      if (cardsCollectionExists) {
        await mongoose.connection.db.dropCollection('cards');
        console.log('Dropped cards collection');
      }
      
      // Recreate indexes based on your Card model
      await BingoCard.createIndexes();
      console.log('Recreated card indexes');
      
      // Also reset all games
      if (game) {
        game.totalCards = 0;
        game.playerCount = 0;
        game.prizeAmount = 0;
        game.calledNumbers = [];
        game.status = 'setup';
        await game.save();
      }
      
      // Clear all user card references
      await User.updateMany({}, { $set: { cards: [] } });
      
      return res.json({
        success: true,
        message: 'Full database reset completed. Cards collection dropped and recreated.',
        mode: 'full-reset',
        affectedCards: 0 // Collection was dropped
      });
    }
    
    // For clear/delete modes, we need a game
    if (!game && mode !== 'full-reset') {
      // If force mode and no game, delete/clear ALL cards regardless of game
      if (force) {
        if (mode === 'delete') {
          const result = await BingoCard.deleteMany({});
          await User.updateMany({}, { $set: { cards: [] } });
          
          return res.json({
            success: true,
            message: `Force deleted all cards from database (${result.deletedCount} cards)`,
            mode: 'delete',
            affectedCards: result.deletedCount
          });
        } else {
          const result = await BingoCard.updateMany({}, {
            $set: {
              markedNumbers: [],
              isWinner: false,
              bingoCount: 0,
              lastMarkedAt: null,
              status: 'active'
            }
          });
          
          return res.json({
            success: true,
            message: `Force cleared all cards in database (${result.modifiedCount} cards)`,
            mode: 'clear',
            affectedCards: result.modifiedCount
          });
        }
      }
      
      return res.status(404).json({ 
        error: 'No game found. Use full-reset mode or enable force mode.' 
      });
    }
    
    // Normal mode with game
    if (game && game.status !== 'setup' && !force) {
      return res.status(400).json({ 
        error: 'Can only reset cards during setup phase. Current status: ' + game.status 
      });
    }
    
    let result;
    
    if (mode === 'delete') {
      // Delete cards for specific game or all if force
      const query = game ? { gameId: game._id } : {};
      result = await BingoCard.deleteMany(query);
      
      // Clear player's card references
      if (game) {
        await User.updateMany(
          { 'cards.gameId': game._id },
          { $pull: { cards: { gameId: game._id } } }
        );
      } else {
        await User.updateMany({}, { $set: { cards: [] } });
      }
      
      console.log(`Deleted ${result.deletedCount} cards`);
      
    } else {
      // Clear cards (reset to unmarked state)
      const query = game ? { gameId: game._id } : {};
      result = await BingoCard.updateMany(query, {
        $set: {
          markedNumbers: [],
          isWinner: false,
          bingoCount: 0,
          lastMarkedAt: null,
          status: 'active',
          completedPatterns: []
        }
      });
      
      console.log(`Cleared ${result.modifiedCount} cards`);
    }
    
    // Reset game stats if game exists
    if (game) {
      game.totalCards = mode === 'delete' ? 0 : game.totalCards;
      game.playerCount = mode === 'delete' ? 0 : game.playerCount;
      game.prizeAmount = 0;
      game.calledNumbers = [];
      await game.save();
    }
    
    res.json({
      success: true,
      message: mode === 'delete'
        ? `Deleted ${result.deletedCount || 0} cards`
        : `Cleared ${result.modifiedCount || 0} cards`,
      mode: mode,
      affectedCards: mode === 'delete' ? result.deletedCount : result.modifiedCount,
      game: game
    });
    
  } catch (error) {
    console.error('Reset cards error:', error);
    res.status(500).json({ error: 'Failed to reset cards: ' + error.message });
  }
});

module.exports = router;