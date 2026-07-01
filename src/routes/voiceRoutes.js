const express = require('express');
const router = express.Router();
const Voice = require('../models/Voice');
const { protect, authorize } = require('../middleware/auth');
const https = require('https');
const fs = require('fs');
const path = require('path');

// GET - Fetch all voices
router.get('/', protect, async (req, res) => {
  const voices = await Voice.find().sort({ number: 1 });
  res.json({ success: true, voices });
});

// GET /debug - Check generated voices (no auth for testing)
router.get('/debug', async (req, res) => {
  const voices = await Voice.find({ audioData: { $exists: true, $ne: null } }).limit(5).sort({ number: 1 });
  const debug = voices.map(v => ({
    number: v.number,
    audioDataLength: v.audioData?.length || 0,
    preview: v.audioData?.substring(0, 80),
  }));
  res.json(debug);
});

// PUT - Save/update a voice
router.put('/:number', protect, authorize('admin','superadmin'), async (req, res) => {
  try {
    const number = parseInt(req.params.number);
    const updateData = {};
    if (req.body.label) updateData.label = req.body.label;
    if (req.body.audioUrl) updateData.audioUrl = req.body.audioUrl;
    if (req.body.audioData) updateData.audioData = req.body.audioData;
    await Voice.updateOne({ number: number }, { $set: updateData }, { upsert: true });
    const voice = await Voice.findOne({ number: number });
    res.json({ success: true, voice });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /init - Create 75 empty slots
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

// POST /generate-all — Generate all 75 voices in Amharic
router.post('/generate-all', protect, authorize('admin', 'superadmin'), async (req, res) => {
  res.json({ success: true, message: 'Generating 75 Amharic voices... ~2 minutes' });
  
  for (let i = 1; i <= 75; i++) {
    const existing = await Voice.findOne({ number: i });
    if (existing?.audioData && existing.audioData.length > 1000 && i <= 4) {
      console.log(`⏭️ Skipping ${i} — already has recording`);
      continue;
    }
    
    const letter = i <= 15 ? 'B' : i <= 30 ? 'I' : i <= 45 ? 'N' : i <= 60 ? 'G' : 'O';
    const text = `${letter} ${i}`;
    
    try {
      const audioData = await new Promise((resolve, reject) => {
        const options = {
          hostname: 'translate.google.com',
          path: `/translate_tts?ie=UTF-8&client=tw-ob&tl=am&q=${encodeURIComponent(text)}`,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': '*/*',
            'Referer': 'https://translate.google.com/',
          }
        };
        
        https.get(options, (response) => {
          const chunks = [];
          response.on('data', chunk => chunks.push(chunk));
          response.on('end', () => {
            const buffer = Buffer.concat(chunks);
            if (buffer.length < 500) {
              reject(new Error('Empty — blocked'));
            } else {
              resolve('data:audio/mpeg;base64,' + buffer.toString('base64'));
            }
          });
        }).on('error', reject);
      });
      
      await Voice.updateOne({ number: i }, { $set: { audioData, audioUrl: null } }, { upsert: true });
      console.log(`✅ Voice ${i}/75 — ${(audioData.length/1024).toFixed(0)}KB`);
    } catch (e) {
      console.log(`❌ Voice ${i} failed:`, e.message);
    }
    
    await new Promise(r => setTimeout(r, 400));
  }
  
  console.log('🎉 All 75 Amharic voices generated!');
});

module.exports = router;