const express = require('express');
const router = express.Router();
const { 
  getAllRules, 
  getRule, 
  createRule, 
  updateRule, 
  deleteRule, 
  testRule,
  saveSample,
  removeSample,
  clearSamples,
  getSamples
} = require('../controllers/mainBingoRuleController');
const { protect, authorize } = require('../middleware/auth');



router.get('/', protect, authorize('admin','superadmin'), getAllRules);
router.get('/:id', protect, authorize('admin','superadmin'), getRule);
router.post('/', protect, authorize('admin','superadmin'), createRule);
router.put('/:id', protect, authorize('admin','superadmin'), updateRule);
router.delete('/:id', protect, authorize('superadmin'), deleteRule);
router.post('/:id/test', protect, authorize('admin','superadmin'), testRule);

// Sample management routes
router.get('/:id/samples', protect, authorize('admin','superadmin'), getSamples);
router.post('/:id/samples', protect, authorize('admin','superadmin'), saveSample);
router.delete('/:id/samples/:type/:index', protect, authorize('admin','superadmin'), removeSample);
router.delete('/:id/samples', protect, authorize('superadmin'), clearSamples);

// PUBLIC: Get hints for current active game (no auth needed for players)
router.get('/public/hints', async (req, res) => {
  try {
    const MainBingoGame = require('../models/MainBingoGame');
    const MainBingoRule = require('../models/MainBingoRule');
    
    const game = await MainBingoGame.getActiveGame();
    if (!game || game.status === 'completed') {
      return res.json({ active: false, message: 'No active game' });
    }
    
    const rule = await MainBingoRule.findById(game.ruleId)
      .select('name description ruleConfig samples');
    
    res.json({
      active: true,
      ruleName: rule?.name,
      ruleDescription: rule?.description,
      freeSpaceCounts: rule?.ruleConfig?.freeSpaceCounts !== false,
      winSamples: rule?.samples?.wins || [],
      lossSamples: rule?.samples?.losses || [],
      cardPrice: game.cardPrice,
      prizeAmount: game.prizeAmount || 'TBD',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
module.exports = router;