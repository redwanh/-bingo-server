const mongoose = require('mongoose');

const cardSchema = new mongoose.Schema({
  cardId: { type: String, unique: true },
  displayId: { type: Number, unique: true, sparse: true, default: undefined },
  serialNumber: Number,
  gameId: { type: mongoose.Schema.Types.ObjectId, ref: 'Game' },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  cardNumber: Number,
  status: { type: String, enum: ['preview', 'registered', 'active','refunded', 'blocked', 'completed'], default: 'preview' },
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
  price: Number
}, { timestamps: true });

cardSchema.pre('save', async function(next) {
  if (!this.cardId) {
    this.cardId = 'CARD-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2,6).toUpperCase();
  }
  if (!this.serialNumber) {
    const last = await this.constructor.findOne().sort({ serialNumber: -1 });
    this.serialNumber = (last?.serialNumber || 0) + 1;
  }
if (this.displayId == null) {
    try {
        const lastDisplay = await this.constructor.findOne({ displayId: { $exists: true, $ne: null } }).sort({ displayId: -1 });
        this.displayId = lastDisplay?.displayId ? lastDisplay.displayId + 1 : 10000;
    } catch(e) {
        this.displayId = Date.now();
    }
}
  next();
});

module.exports = mongoose.model('Card', cardSchema);
