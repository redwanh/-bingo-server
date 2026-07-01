const express = require('express');
const router = express.Router();
const Voice = require('../models/Voice');
const { protect, authorize } = require('../middleware/auth');
const fs = require('fs');
const path = require('path');

// POST /generate-tts/:number — Generate TTS for ONE number
router.post('/generate-tts/:number', protect, authorize('admin', 'superadmin'), async (req, res) => {
  const number = parseInt(req.params.number);
  const letter = number <= 15 ? 'B' : number <= 30 ? 'I' : number <= 45 ? 'N' : number <= 60 ? 'G' : 'O';
  const text = `${letter} ${number}`;
  const filename = `voice_${number}.mp3`;
  const voicesDir = path.join(__dirname, '..', 'public', 'voices');
  const filepath = path.join(voicesDir, filename);

  fs.mkdirSync(voicesDir, { recursive: true });

  const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en&q=${encodeURIComponent(text)}`;
  
  https.get(url, (response) => {
    const file = fs.createWriteStream(filepath);
    response.pipe(file);
    file.on('finish', async () => {
      file.close();
      const audioUrl = `/voices/${filename}`;
      await Voice.updateOne({ number }, { $set: { audioUrl } });
      res.json({ success: true, number, audioUrl });
    });
  }).on('error', (e) => {
    res.status(500).json({ success: false, error: e.message });
  });
});

// POST /generate-all — Generate TTS for ALL 75 numbers
router.post('/generate-all', protect, authorize('admin', 'superadmin'), async (req, res) => {
  res.json({ success: true, message: 'Generating 75 voices...' });
  
  const voicesDir = path.join(__dirname, '..', 'public', 'voices');
  fs.mkdirSync(voicesDir, { recursive: true });

  for (let i = 1; i <= 75; i++) {
    const letter = i <= 15 ? 'B' : i <= 30 ? 'I' : i <= 45 ? 'N' : i <= 60 ? 'G' : 'O';
    const text = `${letter} ${i}`;
    const filename = `voice_${i}.mp3`;
    const filepath = path.join(voicesDir, filename);
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en&q=${encodeURIComponent(text)}`;
    
    try {
      await new Promise((resolve) => {
        https.get(url, (response) => {
          const file = fs.createWriteStream(filepath);
          response.pipe(file);
          file.on('finish', async () => {
            file.close();
            await Voice.updateOne({ number: i }, { $set: { audioUrl: `/voices/${filename}` } });
            console.log(`✅ Generated voice ${i}/75`);
            resolve();
          });
        }).on('error', resolve);
      });
    } catch (e) {
      console.log(`❌ Failed voice ${i}:`, e.message);
    }
    
    // Delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 300));
  }
  
  console.log('🎉 All 75 TTS voices generated!');
});

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