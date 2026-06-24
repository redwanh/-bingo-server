const mongoose = require('mongoose');

const gameSchema = new mongoose.Schema({
  gameId: { type: String, unique: true, required: true },
  gameNumber: { type: Number, required: true },
  roomId: { type: String, required: true },
  status: { type: String, enum: ['scheduled','waiting','in_progress','bingo_called','grace_period','completed'], default: 'scheduled' },
  players: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    cards: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Card' }],
    blockedCards: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Card' }],
    calledBingo: { type: Boolean, default: false },
    isWinner: { type: Boolean, default: false }
  }],
  drawnNumbers: [{ number: Number, letter: String, drawnAt: { type: Date, default: Date.now } }],
  allNumbers: [Number],
  currentNumber: { number: Number, letter: String },
  minCardsToStart: { type: Number, default: 10 },  
  winners: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    cardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Card' },
    winType: String,
    prizeAmount: Number,
    cardGrid: Object,
    winnerName: String,
    winnerPhone: String
  }],
  prizePool: { type: Number, default: 0 },
  totalCards: { type: Number, default: 0 },
  commission: { type: Number, default: 0 },
  startTime: Date,
  endTime: Date,
  timerStartedAt: Date,
  timerDuration: Number,
  gracePeriodEndTime: Date
}, { timestamps: true });

gameSchema.virtual('playerCount').get(function() { return this.players.length; });
gameSchema.methods.canStart = function(minCards, minPlayers) {
  return this.playerCount >= minPlayers && this.totalCards >= minCards;
};
gameSchema.statics.getActiveGame = function(roomId) {
  return this.findOne({ roomId, status: { $in: ['scheduled','waiting','in_progress','bingo_called','grace_period'] } }).sort({ gameNumber: -1 });
};
gameSchema.statics.getLatestGameNumber = async function(roomId) {
  const last = await this.findOne({ roomId }).sort({ gameNumber: -1 });
  return last ? last.gameNumber : 0;
};

module.exports = mongoose.model('Game', gameSchema);
