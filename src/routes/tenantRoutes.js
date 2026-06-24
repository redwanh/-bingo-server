const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const Tenant = require('../models/Tenant');
const { protect, authorize } = require('../middleware/auth');
const upload = require('../middleware/upload');

// Get tenant config (public)
router.get('/config', async (req, res) => {
  try {
    const tenant = await Tenant.findOne({ slug: 'default', isActive: true });
    res.json({ success: true, tenant: tenant || {
      companyName:'Bingo', logoText:'B', logoType:'text', logo:null,
      primaryColor:'#FF4757', secondaryColor:'#FFA502',
      headerBg:'#1a1a2e', headerTextColor:'#ffffff', accentColor:'#2ED573',
      backgroundColor:'#F8F6F3', cardBackground:'#ffffff', balanceLabel:'ETB'
    }});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Upload logo image (superadmin only)
router.post('/upload-logo', protect, authorize('superadmin'), upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const logoUrl = '/uploads/logos/' + req.file.filename;

    // Delete old logo file if exists
    const tenant = await Tenant.findOne({ slug: 'default' });
    if (tenant && tenant.logo) {
      const oldPath = path.join(__dirname, '../../', tenant.logo);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    // Update tenant
    const updated = await Tenant.findOneAndUpdate(
      { slug: 'default' },
      { logo: logoUrl, logoType: 'image' },
      { new: true, upsert: true }
    );

    res.json({ success: true, tenant: updated, logoUrl });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Switch logo type (image or text)
router.put('/logo-type', protect, authorize('superadmin'), async (req, res) => {
  try {
    const { logoType } = req.body;
    const tenant = await Tenant.findOneAndUpdate(
      { slug: 'default' },
      { logoType },
      { new: true, upsert: true }
    );
    res.json({ success: true, tenant });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Apply theme preset
router.put('/theme', protect, authorize('superadmin'), async (req, res) => {
  try {
    const { themePreset, ...colors } = req.body;
    const tenant = await Tenant.findOneAndUpdate(
      { slug: 'default' },
      { themePreset, ...colors },
      { new: true, upsert: true }
    );
    res.json({ success: true, tenant });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Update tenant config (superadmin only)
router.put('/config', protect, authorize('superadmin'), async (req, res) => {
  try {
    const { companyName, logoText, logoType, themePreset, primaryColor, secondaryColor, headerBg, headerTextColor, accentColor, backgroundColor, cardBackground, balanceLabel } = req.body;
    const tenant = await Tenant.findOneAndUpdate(
      { slug: 'default' },
      { companyName, logoText, logoType, themePreset, primaryColor, secondaryColor, headerBg, headerTextColor, accentColor, backgroundColor, cardBackground, balanceLabel },
      { new: true, upsert: true }
    );
    res.json({ success: true, tenant });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
