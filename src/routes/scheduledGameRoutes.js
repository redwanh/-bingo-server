const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const ScheduledGame = require('../models/ScheduledGame');
const MainBingoRule = require('../models/MainBingoRule');

// Get all scheduled games
router.get('/', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const games = await ScheduledGame.find()
      .populate('ruleId', 'name method')
      .sort({ startTime: -1 });
    res.json({ success: true, games });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Create scheduled game
router.post('/', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const { name, ruleId, startTime, cardPrice, prize, maxPlayers } = req.body;
    const game = await ScheduledGame.create({
      name, ruleId, startTime, cardPrice, prize, maxPlayers,
      createdBy: req.user.id
    });
    res.status(201).json({ success: true, game });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Delete scheduled game
router.delete('/:id', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    await ScheduledGame.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Game deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get active scheduled games (for players)
router.get('/active', async (req, res) => {
  try {
    const games = await ScheduledGame.find({ 
      status: { $in: ['scheduled', 'active'] },
      startTime: { $gte: new Date() }
    }).populate('ruleId', 'name method ruleConfig').sort({ startTime: 1 }).limit(10);
    res.json({ success: true, games });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;