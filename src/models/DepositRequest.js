const mongoose = require('mongoose');

const depositRequestSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  paymentAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentAccount', required: true },
  amount: { type: Number, required: true },
  
  // Transaction details from sender
  transactionId: { type: String },           // Telebirr transaction ID
  senderPhone: { type: String },             // Telebirr sender phone
  cbeReference: { type: String },            // CBE reference number
  
  status: { 
    type: String, 
    enum: ['pending', 'approved', 'rejected', 'completed'],
    default: 'pending',
    index: true 
  },
  
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: { type: Date },
  reviewNote: { type: String },
  
  // When approved, link to transaction
  transaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
}, { timestamps: true });

depositRequestSchema.index({ user: 1, status: 1 });
depositRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('DepositRequest', depositRequestSchema);
