const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true, trim: true },
  email: { type: String, lowercase: true, trim: true, sparse: true },
  username: { type: String, unique: true, sparse: true, trim: true, minlength: 3, maxlength: 30 },
  password: { type: String, required: true, minlength: 6, select: false },
  fullName: { type: String, trim: true },
  role: { type: String, enum: ['user', 'admin', 'superadmin', 'finance', 'game'], default: 'user' },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },
  isActive: { type: Boolean, default: true },
  isVerified: { type: Boolean, default: false },
  telegramChatId: { type: String, default: null },
  avatar: { type: String, default: null },
  walletBalance: { type: Number, default: 0 },
  lastLogin: Date,
  loginAttempts: { type: Number, default: 0 },
  lockUntil: Date,

  // SESSION TRACKING
  currentSessionToken: { type: String, default: null },
  currentSocketId: { type: String, default: null },
  lastActive: { type: Date, default: () => new Date() },

  preferences: {
    language: { type: String, default: 'en' },
    notifications: { type: Boolean, default: true }
  },
    // Spending limits
  spendingLimits: {
    enabled: { type: Boolean, default: false },
    daily: { type: Number, default: 0 },
    weekly: { type: Number, default: 0 },
    monthly: { type: Number, default: 0 },
  },
  spendingUsage: {
    daily: { type: Number, default: 0 },
    dailyReset: { type: Date },
    weekly: { type: Number, default: 0 },
    weeklyReset: { type: Date },
    monthly: { type: Number, default: 0 },
    monthlyReset: { type: Date },
  },
   favoriteCartelas: [{
    displayId: Number,
    cardId: String,
    savedAt: { type: Date, default: Date.now }
  }],
}, { timestamps: true });


userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.isLocked = function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
};

userSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
