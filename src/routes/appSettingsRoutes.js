// routes/appSettingsRoutes.js
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const AppSettings = require('../models/AppSettings');
const { protect, authorize } = require('../middleware/auth');
const upload = require('../middleware/upload');
const darkPresets = require('../data/darkPresets');
const lightPresets = require('../data/lightPresets');
const translations = require('../data/translations');

// Get all presets + translations (public)
router.get('/presets', (req, res) => {
  res.json({
    success: true,
    darkPresets,
    lightPresets,
  });
});

// Get translations for a language (public)
router.get('/translations/:lang', (req, res) => {
  const lang = translations[req.params.lang] ? req.params.lang : 'en';
  res.json({ success: true, lang, translations: translations[lang] });
});

// Get all translations (public)
router.get('/translations', (req, res) => {
  res.json({ success: true, translations });
});

// Get app settings (public)
router.get('/config', async (req, res) => {
  try {
    let settings = await AppSettings.findOne({ isActive: true });
    if (!settings) {
      settings = await AppSettings.create({});
    }
    res.json({ success: true, settings });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Upload logo (superadmin only)
router.post('/upload-logo', protect, authorize('superadmin'), upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image file provided' });
    const logoUrl = '/uploads/logos/' + req.file.filename;

    // Delete old logo
    const settings = await AppSettings.findOne({ isActive: true });
    if (settings?.logo) {
      const oldPath = path.join(__dirname, '../../', settings.logo);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    const updated = await AppSettings.findOneAndUpdate(
      { isActive: true },
      { logo: logoUrl, logoType: 'image' },
      { new: true, upsert: true }
    );

    res.json({ success: true, settings: updated, logoUrl });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Update app settings (superadmin only)
router.put('/config', protect, authorize('superadmin'), async (req, res) => {
  try {
    const updates = req.body;
    const settings = await AppSettings.findOneAndUpdate(
      { isActive: true },
      updates,
      { new: true, upsert: true }
    );
    res.json({ success: true, settings });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Apply preset
router.put('/apply-preset', protect, authorize('superadmin'), async (req, res) => {
  try {
    const { presetId, mode } = req.body;
    const presets = mode === 'light' ? lightPresets : darkPresets;
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return res.status(404).json({ error: 'Preset not found' });

    const settings = await AppSettings.findOneAndUpdate(
      { isActive: true },
      {
        activePreset: presetId,
        themeMode: mode,
        [mode]: preset.colors,
      },
      { new: true, upsert: true }
    );
    res.json({ success: true, settings });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
