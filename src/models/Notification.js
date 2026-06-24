const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  type: { type: String, default: 'system' },
  title: String,
  titleAm: String,
  titleTg: String,
  message: String,
  messageAm: String,
  messageTg: String,
  isRead: { type: Boolean, default: false },
  priority: { type: String, default: 'normal' },
  amount: Number,
  expiresAt: Date
}, { timestamps: true });

notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ isRead: 1 });

module.exports = mongoose.model('Notification', notificationSchema);
