const mongoose = require('mongoose');

const cmsSchema = new mongoose.Schema({
  type: { type: String, enum: ['terms', 'faq', 'contact'], required: true, index: true },
  language: { type: String, enum: ['en', 'am', 'tg'], required: true, index: true },
  title: { type: String },
  content: { type: String },
  question: { type: String },
  answer: { type: String },
  order: { type: Number, default: 0 },
  contactType: { type: String, enum: ['phone', 'email', 'address', 'telegram', 'whatsapp', 'other'] },
  value: { type: String },
  label: { type: String },
  isActive: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

cmsSchema.index({ type: 1, language: 1 });
module.exports = mongoose.model('CMS', cmsSchema);
