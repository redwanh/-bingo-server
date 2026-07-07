const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        'card_purchase',
        'prize',
        'prize_win',
        'commission',
        'refund',
        'cash',
        'deposit',
        'bonus',
        'transfer_out',
        'transfer_in',
        'withdrawal',
        'adjustment',
        'admin_deposit',      // ← NEW
        'admin_charge',       // ← NEW
      ],
      required: true,
    },
    amount: {
      type: Number,
      required: true, // Positive = credit, Negative = debit
    },
    balanceBefore: { type: Number, default: 0 },
    balanceAfter: { type: Number, default: 0 },
    direction: {
      type: String,
      enum: ['credit', 'debit'],
      default: 'credit',
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'reversed'],
      default: 'completed',
    },
    gameId: { type: String, default: null },
    gameNumber: { type: Number, default: null },
    description: { type: String },
    reference: { type: String },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    performedByRole: { type: String, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    isReconciled: { type: Boolean, default: false },
    reconciledAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Indexes
transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ type: 1, createdAt: -1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ gameId: 1 });
transactionSchema.index({ reference: 1 }, { unique: true, sparse: true });

// Generate reference number before save
transactionSchema.pre('save', function (next) {
  if (!this.reference) {
    const prefix = this.type === 'admin_deposit' ? 'ADM-DEP' :
                   this.type === 'admin_charge' ? 'ADM-CHG' :
                   this.type === 'deposit' ? 'DEP' :
                   this.type === 'withdrawal' ? 'WTD' : 'TXN';
    this.reference = `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  }
  next();
});

module.exports = mongoose.model('Transaction', transactionSchema);