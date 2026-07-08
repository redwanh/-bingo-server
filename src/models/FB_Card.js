// ============================================================
// server/src/models/FB_Card.js
// Fast Bingo Card Model - Separate from old Card model
// ============================================================

const mongoose = require('mongoose');

const fbCardSchema = new mongoose.Schema({
  displayId: { type: Number, unique: true, required: true },
  gameId: { type: mongoose.Schema.Types.ObjectId, ref: 'FB_Game', default: null },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  cardNumber: Number,
  status: {
    type: String,
    enum: ['available', 'preview', 'reserved', 'registered', 'blocked', 'completed'],
    default: 'available'
  },
  grid: {
    B: [{ number: Number, isMarked: { type: Boolean, default: false } }],
    I: [{ number: Number, isMarked: { type: Boolean, default: false } }],
    N: [{ number: Number, isMarked: { type: Boolean, default: false } }],
    G: [{ number: Number, isMarked: { type: Boolean, default: false } }],
    O: [{ number: Number, isMarked: { type: Boolean, default: false } }]
  },
  isBlocked: { type: Boolean, default: false },
  blockReason: String,
  bingoCalled: { type: Boolean, default: false },
  bingoValidated: { type: Boolean, default: false },
  winType: String,
  price: { type: Number, default: 0 },
  reservedAt: Date,
  reservedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  registeredAt: Date
}, { timestamps: true });

module.exports = mongoose.model('FB_Card', fbCardSchema);