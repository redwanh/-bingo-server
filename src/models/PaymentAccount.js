const mongoose = require('mongoose');

const paymentAccountSchema = new mongoose.Schema({
  type: { type: String, enum: ['telebirr', 'cbe'], required: true },
  accountName: { type: String, required: true },          // Account holder name
  phone: { type: String },                                 // For Telebirr
  accountNumber: { type: String },                         // For CBE
  isActive: { type: Boolean, default: true },
  displayOrder: { type: Number, default: 0 },
  
  // Instructions in 3 languages
  instructionsEn: { type: String },
  instructionsAm: { type: String },
  instructionsTg: { type: String },
  
  // Limits
  minDeposit: { type: Number, default: 50 },
  maxDeposit: { type: Number, default: 50000 },
}, { timestamps: true });

module.exports = mongoose.model('PaymentAccount', paymentAccountSchema);
