// ============================================================
// server/src/models/FB_Game.js
// Fast Bingo Game Model - Separate from old Game model
// ============================================================

const mongoose = require('mongoose');

const fbGameSchema = new mongoose.Schema({
  gameId: { type: String, unique: true, required: true },
  gameNumber: { type: Number, required: true },
  roomId: { type: String, required: true, default: 'fast_bingo' },
  status: {
    type: String,
    enum: ['scheduled', 'waiting', 'in_progress', 'bingo_called', 'grace_period', 'completed'],
    default: 'scheduled'
  },
  players: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    cards: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Card' }],
    calledBingo: { type: Boolean, default: false },
    isWinner: { type: Boolean, default: false }
  }],
  drawnNumbers: [{
    number: Number,
    letter: String,
    drawnAt: { type: Date, default: Date.now }
  }],
  allNumbers: [Number],
  currentNumber: {
    number: Number,
    letter: String
  },
  winners: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    cardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Card' },
    winType: String,
    prizeAmount: Number,
    cardGrid: Object,
    cardNumber: Number,
    winnerName: String,
    winnerPhone: String,
    newBalance: Number
  }],
  prizePool: { type: Number, default: 0 },
  totalCards: { type: Number, default: 0 },
  commission: { type: Number, default: 0 },
  startTime: Date,
  endTime: Date,
  endReason: String,
  timerStartedAt: Date,
  timerDuration: Number,
  gracePeriodEndTime: Date
}, { timestamps: true });

// ══════════════════════════════════════
// VIRTUALS
// ══════════════════════════════════════
fbGameSchema.virtual('playerCount').get(function () {
  return this.players ? this.players.length : 0;
});

// ══════════════════════════════════════
// METHODS
// ══════════════════════════════════════
fbGameSchema.methods.canStart = function (minPlayers) {
  return this.playerCount >= minPlayers;
};

// ══════════════════════════════════════
// STATICS
// ══════════════════════════════════════
fbGameSchema.statics.getActiveGame = function (roomId) {
  return this.findOne({
    roomId,
    status: { $in: ['scheduled', 'waiting', 'in_progress', 'bingo_called', 'grace_period'] }
  }).sort({ gameNumber: -1 });
};

fbGameSchema.statics.getLatestGameNumber = async function (roomId) {
  const last = await this.findOne({ roomId }).sort({ gameNumber: -1 });
  return last ? last.gameNumber : 0;
};

module.exports = mongoose.model('FB_Game', fbGameSchema);