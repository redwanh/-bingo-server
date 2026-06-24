const mongoose = require('mongoose');

const withdrawalSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  amount: { type: Number, required: true },
  type: { type: String, enum: ['telebirr', 'cbe'], required: true },
  accountInfo: { type: String, default: 'Pending' },       // Phone or account number
  status: { 
    type: String, 
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
    index: true 
  },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: { type: Date },
  reviewNote: { type: String },
  transaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
}, { timestamps: true });

module.exports = mongoose.model('Withdrawal', withdrawalSchema);

