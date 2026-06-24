const mongoose = require('mongoose');
const mainBingoConfigSchema = new mongoose.Schema({
  ruleId: { type: mongoose.Schema.Types.ObjectId, ref: 'MainBingoRule', required: true },
  ruleName: String,
  cardPrice: { type: Number, required: true, min: 1 },
  maxCardsPerPlayer: { type: Number, default: 10 },
  prizeAmount: { type: Number, default: 0 },
  status: { type: String, enum: ['setup','countdown','in_progress','completed'], default: 'setup' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });
module.exports = mongoose.model('MainBingoConfig', mainBingoConfigSchema);
