const mongoose = require('mongoose');

const scheduledGameSchema = new mongoose.Schema({
  name: { type: String, required: true },
  ruleId: { type: mongoose.Schema.Types.ObjectId, ref: 'MainBingoRule', required: true },
  startTime: { type: Date, required: true },
  cardPrice: { type: Number, default: 10 },
  prize: { type: Number, default: 100 },
  maxPlayers: { type: Number, default: 50 },
  status: { type: String, enum: ['scheduled', 'active', 'completed', 'cancelled'], default: 'scheduled' },
  players: [{ userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, cards: [String] }],
  winners: [{ userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, prize: Number }],
  drawnNumbers: [Number],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('ScheduledGame', scheduledGameSchema);