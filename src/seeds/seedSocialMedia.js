// forceSeed.js
const mongoose = require('mongoose');
const AppSettings = require('../models/AppSettings');

const MONGO_URI = 'mongodb://localhost:27017/bingo-platform';

async function forceSeed() {
  try {
    console.log('🔗 Connecting to:', MONGO_URI);
    await mongoose.connect(MONGO_URI);
    console.log('📦 Connected!');
    
    const settings = await AppSettings.findOneAndUpdate(
      { isActive: true },
      { 
        $set: {
          // ADD LOGO BACK
          logo: '/uploads/logos/logo-1781794874264-498631228.png',
          logoType: 'image',
          
          // App names
          appName: '10 20',
          appNameAm: '10 200',
          appNameTg: '100 200',
          
          // Social media
          'socialMedia.facebook.url': 'https://facebook.com/yourpage',
          'socialMedia.facebook.icon': '/uploads/social/facebook-icon.png',
          'socialMedia.facebook.active': true,
          'socialMedia.telegram.url': 'https://t.me/yourchannel',
          'socialMedia.telegram.icon': '/uploads/social/telegram-icon.png',
          'socialMedia.telegram.active': true,
          'socialMedia.tiktok.url': 'https://tiktok.com/@yourhandle',
          'socialMedia.tiktok.icon': '/uploads/social/tiktok-icon.png',
          'socialMedia.tiktok.active': true,
        }
      },
      { new: true }
    );

    console.log('✅ Updated!');
    console.log('Logo:', settings.logo);
    console.log('App Name:', settings.appName);
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await mongoose.disconnect();
  }
}

forceSeed();