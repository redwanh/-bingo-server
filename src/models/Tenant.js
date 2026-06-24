const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema({
  name: { type: String, default: 'Bingo' },
  slug: { type: String, unique: true, default: 'default' },
  companyName: { type: String, default: 'Bingo Platform' },
  logo: { type: String, default: null },           // Image URL/path
  logoText: { type: String, default: 'B' },         // Fallback text
  logoType: { type: String, enum: ['image', 'text'], default: 'text' }, // Which to show
  themePreset: { type: String, default: null },     // Active theme preset name
  primaryColor: { type: String, default: '#FF4757' },
  secondaryColor: { type: String, default: '#FFA502' },
  headerBg: { type: String, default: '#1a1a2e' },
  headerTextColor: { type: String, default: '#ffffff' },
  accentColor: { type: String, default: '#2ED573' },
  backgroundColor: { type: String, default: '#F8F6F3' },
  cardBackground: { type: String, default: '#ffffff' },
  balanceLabel: { type: String, default: 'ETB' },
  isActive: { type: Boolean, default: true },
  settings: {
    allowRegistration: { type: Boolean, default: true },
    requireOTP: { type: Boolean, default: true },
    minWithdrawal: { type: Number, default: 100 },
    maxWithdrawal: { type: Number, default: 50000 }
  }
}, { timestamps: true });

module.exports = mongoose.model('Tenant', tenantSchema);
