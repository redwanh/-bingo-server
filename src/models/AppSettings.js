// models/AppSettings.js
const mongoose = require('mongoose');

const appSettingsSchema = new mongoose.Schema({
  // Application Identity
  appName: { type: String, default: 'Lucky Night Bingo' },
  appNameAm: { type: String, default: 'ላኪ ናይት ቢንጎ' },
  appNameTg: { type: String, default: 'ለኪ ናይት ቢንጎ' },

  // Logo
  logo: { type: String, default: null },
  logoText: { type: String, default: '🎱' },
  logoType: { type: String, enum: ['image', 'text', 'emoji'], default: 'emoji' },

  // Theme
  themeMode: { type: String, enum: ['light', 'dark'], default: 'dark' },
  activePreset: { type: String, default: 'midnight' },

  // Colors
  dark: {
    primaryColor: { type: String, default: '#FFD700' },
    secondaryColor: { type: String, default: '#FF8C00' },
    headerBg: { type: String, default: '#1a1a2e' },
    headerTextColor: { type: String, default: '#ffffff' },
    accentColor: { type: String, default: '#2ED573' },
    backgroundColor: { type: String, default: '#F0F2F5' },
    cardBg: { type: String, default: '#16213e' },
    inputBg: { type: String, default: 'rgba(255,255,255,0.08)' },
    textColor: { type: String, default: '#ffffff' },
    mutedText: { type: String, default: '#A0A0B8' },
  },
  light: {
    primaryColor: { type: String, default: '#E11D48' },
    secondaryColor: { type: String, default: '#F43F5E' },
    headerBg: { type: String, default: '#FFFFFF' },
    headerTextColor: { type: String, default: '#1a1a2e' },
    accentColor: { type: String, default: '#059669' },
    backgroundColor: { type: String, default: '#F8F6F3' },
    cardBg: { type: String, default: '#FFFFFF' },
    inputBg: { type: String, default: '#F5F5F5' },
    textColor: { type: String, default: '#1a1a2e' },
    mutedText: { type: String, default: '#666666' },
  },

  // Languages
  defaultLanguage: { type: String, enum: ['en', 'am', 'tg'], default: 'en' },
  availableLanguages: [{ type: String, enum: ['en', 'am', 'tg'] }],

  // Terms & Conditions (multi-language)
  termsEnabled: { type: Boolean, default: true },
  termsEn: { type: String, default: 'By registering, you agree to our Terms of Service and Privacy Policy.' },
  termsAm: { type: String, default: 'በመመዝገብ፣ የአገልግሎት ውሎቻችንን እና የግላዊነት ፖሊሲያችንን ተቀበሉ።' },
  termsTg: { type: String, default: 'ብምዝገባኻ፣ ናይ ኣገልግሎት ውላትናን ናይ ግላዊ ፖሊሲናን ተቐበልካ።' },
  termsLink: { type: String, default: '/terms' },

  // Other
  balanceLabel: { type: String, default: 'ETB' },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('AppSettings', appSettingsSchema);
