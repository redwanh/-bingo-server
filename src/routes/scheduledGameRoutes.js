const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const ScheduledGame = require('../models/ScheduledGame');
const MainBingoRule = require('../models/MainBingoRule');

// Get all scheduled games
router.get('/', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const games = await ScheduledGame.find()
      .populate('ruleId', 'name method ruleConfig')
      .sort({ startTime: -1 });
    res.json({ success: true, games });
  } catch (e) { 
    console.error('Get games error:', e);
    res.status(500).json({ error: e.message }); 
  }
});

// ✅ FIXED: Create scheduled game with rule validation
router.post('/', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const { name, ruleId, startTime, cardPrice, prize, maxPlayers } = req.body;
    
    console.log('📝 Creating scheduled game with:', { name, ruleId, startTime });
    
    // ✅ VALIDATE: Check if rule exists
    if (ruleId) {
      const rule = await MainBingoRule.findById(ruleId);
      if (!rule) {
        console.log('❌ Rule not found:', ruleId);
        return res.status(400).json({ 
          error: `Rule with ID ${ruleId} not found. Please select a valid rule.` 
        });
      }
      console.log('✅ Rule found:', rule.name);
    }
    
    // Create the game
    const game = await ScheduledGame.create({
      name,
      ruleId: ruleId || null,  // If no rule, set to null
      startTime,
      cardPrice,
      prize,
      maxPlayers,
      createdBy: req.user.id,
      status: 'scheduled'
    });
    
    // ✅ Populate the rule before returning
    const populatedGame = await ScheduledGame.findById(game._id)
      .populate('ruleId', 'name method ruleConfig');
    
    console.log('✅ Game created:', populatedGame._id);
    res.status(201).json({ 
      success: true, 
      game: populatedGame,
      message: 'Game scheduled successfully'
    });
  } catch (e) { 
    console.error('Create game error:', e);
    res.status(400).json({ error: e.message }); 
  }
});

// Delete scheduled game
router.delete('/:id', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const game = await ScheduledGame.findByIdAndDelete(req.params.id);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    res.json({ success: true, message: 'Game deleted' });
  } catch (e) { 
    console.error('Delete game error:', e);
    res.status(500).json({ error: e.message }); 
  }
});

// Reset game
router.post('/:id/reset', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const game = await ScheduledGame.findById(req.params.id);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    game.status = 'scheduled';
    game.players = [];
    game.winners = [];
    game.drawnNumbers = [];
    await game.save();
    res.json({ success: true, message: 'Game reset', game });
  } catch (e) { 
    console.error('Reset game error:', e);
    res.status(500).json({ error: e.message }); 
  }
});

// Get active scheduled games (for players)
router.get('/active', protect, async (req, res) => {
  try {
    const games = await ScheduledGame.find({ 
      status: { $in: ['scheduled', 'active'] },
      startTime: { $gte: new Date() }
    })
    .populate('ruleId', 'name method ruleConfig')
    .sort({ startTime: 1 })
    .limit(10);
    
    res.json({ success: true, games });
  } catch (e) { 
    console.error('Get active games error:', e);
    res.status(500).json({ error: e.message }); 
  }
});

module.exports = router;