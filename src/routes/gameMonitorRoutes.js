const express = require('express');
const router = express.Router();
const Game = require('../models/Game');
const { protect, authorize } = require('../middleware/auth');

// Get active game status
router.get('/active', protect, authorize('admin','superadmin'), async (req, res) => {
  const games = await Game.find({ status: { $ne: 'completed' } })
    .select('gameId gameNumber roomId status playerCount totalCards prizePool startTime timerStartedAt')
    .sort({ createdAt: -1 });
  res.json({ success: true, games });
});

// Get game history
router.get('/history', protect, authorize('admin','superadmin'), async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const games = await Game.find({ status: 'completed' })
    .select('gameId gameNumber roomId status playerCount totalCards prizePool winners commission startTime endTime')
    .sort({ endTime: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));
  const total = await Game.countDocuments({ status: 'completed' });
  res.json({ success: true, games, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) } });
});

// Get game details
router.get('/:gameId', protect, authorize('admin','superadmin'), async (req, res) => {
  const game = await Game.findOne({ gameId: req.params.gameId }).populate('winners.userId', 'fullName phone');
  res.json({ success: true, game });
});

module.exports = router;
