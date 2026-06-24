const express = require('express');
const router = express.Router();
const Card = require('../models/Card');
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/auth');

// Get available cards (not used in any game)
router.get('/available', protect, async (req, res) => {
  try {
    const cards = await Card.find({ isUsed: false, isBlocked: false })
      .select('cardId serialNumber grid.B grid.I grid.N grid.G grid.O')
      .limit(50);
    
    res.json({ success: true, count: cards.length, cards });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get single card by ID
router.get('/:cardId', protect, async (req, res) => {
  try {
    const card = await Card.findOne({ 
      $or: [
        { cardId: req.params.cardId },
        { serialNumber: parseInt(req.params.cardId) || 0 }
      ]
    });
    
    if (!card) {
      return res.status(404).json({ success: false, message: 'Card not found' });
    }
    
    res.json({ success: true, card });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Admin: Get card stats
router.get('/stats/summary', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const [total, available, used, blocked] = await Promise.all([
      Card.countDocuments(),
      Card.countDocuments({ isUsed: false, isBlocked: false }),
      Card.countDocuments({ isUsed: true }),
      Card.countDocuments({ isBlocked: true })
    ]);
    
    res.json({
      success: true,
      stats: { total, available, used, blocked }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
