const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  phone: { type: String, required: true, index: true },
  code: { type: String, required: true },
  purpose: { type: String, enum: ['authentication', 'registration', 'reset_password'], default: 'authentication' },
  verified: { type: Boolean, default: false },
  attempts: { type: Number, default: 0, max: 5 },
  expiresAt: { type: Date, required: true, index: true },
  smsProvider: { type: String },
  channel: { 
  type: String, 
  enum: ['test', 'sms', 'telegram', 'email'], 
  default: 'test' 
},
  smsSent: { type: Boolean, default: false },
}, { timestamps: true });

// TTL Index - auto-delete expired OTPs
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
otpSchema.index({ phone: 1, createdAt: -1 });

// Compound index for rate limiting
otpSchema.index({ phone: 1, createdAt: 1 });

module.exports = mongoose.model('Otp', otpSchema);
