const express = require('express');
const router = express.Router();
const Voice = require('../models/Voice');
const { protect, authorize } = require('../middleware/auth');

// GET - Any logged-in user can fetch voices
router.get('/', protect, async (req, res) => {          // ← NO authorize here!
  const voices = await Voice.find().sort({ number: 1 });
  res.json({ success: true, voices });
});

// PUT - Admin only
router.put('/:number', protect, authorize('admin','superadmin'), async (req, res) => {
  try {
    const number = parseInt(req.params.number);
    const updateData = {};
    if (req.body.label) updateData.label = req.body.label;
    if (req.body.audioUrl) updateData.audioUrl = req.body.audioUrl;
    if (req.body.audioData) updateData.audioData = req.body.audioData;
    await Voice.updateOne({ number: number }, { $set: updateData }, { upsert: true });
    const voice = await Voice.findOne({ number: number });
    console.log('Voice #' + number + ' saved. Has audio:', !!voice.audioData);
    res.json({ success: true, voice });
  } catch (e) {
    console.error('Save error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST - Superadmin only
router.post('/init', protect, authorize('superadmin'), async (req, res) => {
  for (let i = 1; i <= 75; i++) {
    const letter = i <= 15 ? 'B' : i <= 30 ? 'I' : i <= 45 ? 'N' : i <= 60 ? 'G' : 'O';
    await Voice.updateOne(
      { number: i },
      { $setOnInsert: { number: i, letter: letter, label: `${letter}-${i}` } },
      { upsert: true }
    );
  }
  res.json({ success: true, message: '75 voice slots ready' });
});

module.exports = router;