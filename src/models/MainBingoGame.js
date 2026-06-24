const mongoose = require('mongoose');
const mainBingoGameSchema = new mongoose.Schema({
  gameId: { type: String, unique: true, required: true },
  gameNumber: { type: Number, required: true },
  configId: { type: mongoose.Schema.Types.ObjectId, ref: 'MainBingoConfig' },
  ruleId: { type: mongoose.Schema.Types.ObjectId, ref: 'MainBingoRule' },
  status: { type: String, enum: ['setup','countdown','in_progress','bingo_called','grace_period','completed'], default: 'setup' },
  players: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    cards: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Card' }],
    blockedCards: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Card' }],
    calledBingo: Boolean,
    isWinner: Boolean
  }],
  drawnNumbers: [{ number: Number, letter: String }],
  allNumbers: [Number],
  currentNumber: { number: Number, letter: String },
  winners: [{
    userId: mongoose.Schema.Types.ObjectId,
    cardId: mongoose.Schema.Types.ObjectId,
    winType: String,
    prizeAmount: Number,
    cardGrid: Object,
    winnerName: String,
    winnerPhone: String
  }],
  prizeAmount: { type: Number, default: 0 },
  totalCards: { type: Number, default: 0 },
  startTime: Date,
  endTime: Date,
  countdownStartedAt: Date,
  gracePeriodEndTime: Date
}, { timestamps: true });
mainBingoGameSchema.virtual('playerCount').get(function() { return this.players.length; });
mainBingoGameSchema.statics.getActiveGame = function() { return this.findOne({ status: { $ne: 'completed' } }).sort({ createdAt: -1 }); };
mainBingoGameSchema.statics.getLatestGameNumber = async function() { const last = await this.findOne().sort({ gameNumber: -1 }); return last ? last.gameNumber : 0; };
module.exports = mongoose.model('MainBingoGame', mainBingoGameSchema);
