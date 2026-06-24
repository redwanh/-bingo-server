const mongoose = require('mongoose');

const voiceSchema = new mongoose.Schema({
  number: { type: Number, required: true, unique: true },
  letter: { type: String },
  label: { type: String },
  audioUrl: { type: String, default: null },
  audioData: { type: String, default: null },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Voice', voiceSchema);
