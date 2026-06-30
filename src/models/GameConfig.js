const mongoose = require('mongoose');

const gameConfigSchema = new mongoose.Schema({
  roomId: { type: String, unique: true, required: true },
  roomName: { type: String, default: 'Fast Bingo' },
  cardPrice: { type: Number, default: 10 },
  maxCardsPerPlayer: { type: Number, default: 5 },
  minPlayersToStart: { type: Number, default: 3 },
  waitTimeSeconds: { type: Number, default: 30 },
  drawIntervalSeconds: { type: Number, default: 5 },
  commissionPercentage: { type: Number, default: 10 },
  gracePeriodSeconds: { type: Number, default: 10 },
  resetOnNoPlayers: { type: Boolean, default: true },
  voiceEnabled: { type: Boolean, default: true },
  autoMarkDefault: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  isLastNumberCalledBingo: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('GameConfig', gameConfigSchema);
