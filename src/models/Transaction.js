const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  // === GAME TRANSACTION FIELDS (original) ===
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  type: {
    type: String,
   enum: ['card_purchase', 'prize', 'prize_win', 'commission', 'refund', 'cash', 'deposit', 'bonus','transfer_out','transfer_in', 'withdrawal', 'adjustment'],
  },
  amount: { type: Number, required: true },         // Negative for debits, positive for credits
  gameId: { type: String, default: null },           // Game reference (e.g., "0000000017")
  gameNumber: { type: Number, default: null },       // Game number
  description: { type: String },                     // "Card #14", "Manual credit", etc.
  balanceAfter: { type: Number },                    // Wallet balance after transaction
  
  // === FINANCE/ADMIN FIELDS (new) ===
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },  // Alias for userId
  balanceBefore: { type: Number },                   // Balance before transaction
  direction: { type: String, enum: ['credit', 'debit'] },       // credit = money in, debit = money out
  status: { type: String, enum: ['pending', 'completed', 'failed', 'reversed'], default: 'completed' },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  performedByRole: { type: String },
  reference: { type: String },                       // "ADD-XXX", "GAME-XXX"
  
  // === RECONCILIATION ===
  reconciliationId: { type: String },
  reconciledAt: { type: Date },
  isReconciled: { type: Boolean, default: false },
  
  // === METADATA ===
  metadata: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

// Indexes
transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ user: 1, createdAt: -1 });
transactionSchema.index({ type: 1, createdAt: -1 });
transactionSchema.index({ gameId: 1 });
transactionSchema.index({ status: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
