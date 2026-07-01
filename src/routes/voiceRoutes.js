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

// POST /generate-all — Generate TTS for ALL 75 numbers as base64 (one-time)


router.post('/generate-all', protect, authorize('admin', 'superadmin'), async (req, res) => {
  res.json({ success: true, message: 'Generating 75 voices... takes ~2 minutes' });
  
  for (let i = 1; i <= 75; i++) {
    const existing = await Voice.findOne({ number: i });
    if (existing?.audioData && i <= 4) {
      console.log(`⏭️ Skipping ${i} — already recorded`);
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
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://translate.google.com/',
  }
};
        
        https.get(options, (response) => {
          const chunks = [];
          response.on('data', chunk => chunks.push(chunk));
          response.on('end', () => {
            const buffer = Buffer.concat(chunks);
            if (buffer.length < 500) {
              reject(new Error('Empty response — likely blocked'));
            } else {
              resolve('data:audio/mpeg;base64,' + buffer.toString('base64'));
            }
          });
        }).on('error', reject);
      });
      
      await Voice.updateOne(
        { number: i },
        { $set: { audioData, audioUrl: null } },
        { upsert: true }
      );
      
      console.log(`✅ Voice ${i}/75 — ${(audioData.length/1024).toFixed(0)}KB`);
    } catch (e) {
      console.log(`❌ Voice ${i} failed:`, e.message);
    }
    
    await new Promise(r => setTimeout(r, 400));
  }
  
  console.log('🎉 Done!');
});
// GET - Any logged-in user can fetch voices
// GET - Auto-generate missing TTS as base64
router.get('/', protect, async (req, res) => {
  const voices = await Voice.find().sort({ number: 1 });
  res.json({ success: true, voices });
});

router.get('/debug', async (req, res) => {
  const start = parseInt(req.query.start) || 1;
  const voices = await Voice.find({ 
    number: { $gte: start },
    audioData: { $exists: true, $ne: null } 
  }).limit(5).sort({ number: 1 });
  
  const debug = voices.map(v => ({
    number: v.number,
    audioDataLength: v.audioData?.length || 0,
    preview: v.audioData?.substring(0, 80),
  }));
  res.json(debug);
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