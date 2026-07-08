const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Notification = require('../models/Notification');
const Card = require('../models/Card');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

// Constants
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;
const MAX_SEARCH_LENGTH = 100;
const ALLOWED_ROLES = ['user', 'admin', 'superadmin', 'finance', 'game'];
const isValidObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(id);
const MAX_DEPOSIT = 5000;

const sanitizeSearch = (search) => {
  if (!search || typeof search !== 'string') return '';
  return search.slice(0, MAX_SEARCH_LENGTH).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').trim();
};

// ========== ADMIN: BALANCE MANAGEMENT ==========

exports.addBalance = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return next(new AppError('Invalid user ID', 400));
    const { amount, description } = req.body;
    const numAmount = parseFloat(amount);
    if (!amount || isNaN(numAmount) || numAmount <= 0) return next(new AppError('Please provide a valid positive amount', 400));
    if (numAmount > MAX_DEPOSIT) return next(new AppError(`Maximum single deposit is ${MAX_DEPOSIT.toLocaleString()}`, 400));
    if (req.params.id === req.user._id.toString()) return next(new AppError('You cannot modify your own balance', 400));

    const user = await User.findById(req.params.id);
    if (!user) return next(new AppError('User not found', 404));

    const balanceBefore = user.walletBalance || 0;
    const balanceAfter = balanceBefore + numAmount;
    user.walletBalance = balanceAfter;
    await user.save();

    const transaction = await Transaction.create({
      userId: user._id, type: 'admin_deposit', amount: numAmount,
      balanceBefore, balanceAfter, direction: 'credit', status: 'completed',
      description: description || `Admin deposit by ${req.user.fullName || req.user.phone}`,
      performedBy: req.user._id, performedByRole: req.user.role,
    });

    await Notification.create({
      user: user._id, type: 'balance', title: '💰 Balance Added',
      message: `${numAmount.toLocaleString()} added. New balance: ${balanceAfter.toLocaleString()}`,
      priority: 'normal', amount: numAmount, transactionId: transaction._id,
    });

    await User.findByIdAndUpdate(user._id, { $inc: { unreadNotifications: 1 } });

    logger.money('Admin deposit', { adminId: req.user._id, userId: user._id, amount: numAmount, balanceBefore, balanceAfter });

    res.status(200).json({ success: true, message: `Added ${numAmount.toLocaleString()} to ${user.fullName || user.phone}`, data: { balanceBefore, balanceAfter, amount: numAmount, transaction } });
  } catch (error) { logger.error('Add balance failed', { error: error.message }); next(error); }
};

exports.chargeUser = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return next(new AppError('Invalid user ID', 400));
    const { amount, description } = req.body;
    const numAmount = parseFloat(amount);
    if (!amount || isNaN(numAmount) || numAmount <= 0) return next(new AppError('Please provide a valid positive amount', 400));

    const user = await User.findById(req.params.id);
    if (!user) return next(new AppError('User not found', 404));

    const balanceBefore = user.walletBalance || 0;
    if (balanceBefore < numAmount) return next(new AppError(`Insufficient balance. Current: ${balanceBefore.toLocaleString()}`, 400));

    const balanceAfter = balanceBefore - numAmount;
    user.walletBalance = balanceAfter;
    await user.save();

    const transaction = await Transaction.create({
      userId: user._id, type: 'admin_charge', amount: -numAmount,
      balanceBefore, balanceAfter, direction: 'debit', status: 'completed',
      description: description || `Admin charge by ${req.user.fullName || req.user.phone}`,
      performedBy: req.user._id, performedByRole: req.user.role,
    });

    await Notification.create({
      user: user._id, type: 'balance', title: '💸 Balance Deducted',
      message: `${numAmount.toLocaleString()} deducted. New balance: ${balanceAfter.toLocaleString()}`,
      priority: 'high', amount: numAmount, transactionId: transaction._id,
    });

    await User.findByIdAndUpdate(user._id, { $inc: { unreadNotifications: 1 } });

    logger.money('Admin charge', { adminId: req.user._id, userId: user._id, amount: -numAmount, balanceBefore, balanceAfter });

    res.status(200).json({ success: true, message: `Deducted ${numAmount.toLocaleString()} from ${user.fullName || user.phone}`, data: { balanceBefore, balanceAfter, amount: numAmount, transaction } });
  } catch (error) { logger.error('Charge user failed', { error: error.message }); next(error); }
};

// ========== ADMIN: USER MANAGEMENT ==========

exports.getAllUsers = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.limit) || DEFAULT_PAGE_SIZE));
    const skip = (page - 1) * limit;
    const filter = {};

    if (req.query.search) {
      const safeSearch = sanitizeSearch(req.query.search);
      if (safeSearch) filter.$or = [{ phone: { $regex: safeSearch, $options: 'i' } }, { fullName: { $regex: safeSearch, $options: 'i' } }, { username: { $regex: safeSearch, $options: 'i' } }, { email: { $regex: safeSearch, $options: 'i' } }];
    }
    if (req.query.role && ALLOWED_ROLES.includes(req.query.role)) filter.role = req.query.role;
    if (req.query.isActive !== undefined) filter.isActive = req.query.isActive === 'true';

    const sortMap = { newest: { createdAt: -1 }, oldest: { createdAt: 1 }, name: { fullName: 1 }, balance_high: { walletBalance: -1 }, balance_low: { walletBalance: 1 }, role: { role: 1 } };
    const sort = sortMap[req.query.sort] || { createdAt: -1 };

    const [users, total] = await Promise.all([
      User.find(filter).select('-password -refreshToken -currentSessionToken -loginAttempts -otpCode').sort(sort).skip(skip).limit(limit).lean(),
      User.countDocuments(filter),
    ]);

    res.set('Cache-Control', 'private, max-age=30');
    res.status(200).json({ success: true, users, pagination: { page, limit, total, pages: Math.ceil(total / limit), hasNextPage: page < Math.ceil(total / limit), hasPrevPage: page > 1 } });
  } catch (error) { logger.error('Failed to fetch users', { error: error.message }); next(error); }
};

exports.getUser = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return next(new AppError('Invalid user ID', 400));
    const user = await User.findById(req.params.id).select('-password -refreshToken -currentSessionToken');
    if (!user) return next(new AppError('User not found', 404));
    res.set('Cache-Control', 'private, max-age=60');
    res.status(200).json({ success: true, user });
  } catch (error) { next(error); }
};

exports.updateUser = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return next(new AppError('Invalid user ID', 400));
    const allowedUpdates = ['fullName', 'username', 'email', 'role', 'isActive', 'walletBalance'];
    const updates = {};
    for (const field of Object.keys(req.body)) { if (allowedUpdates.includes(field)) updates[field] = req.body[field]; }
    if (updates.role && !ALLOWED_ROLES.includes(updates.role)) return next(new AppError('Invalid role', 400));
    if (updates.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.email)) return next(new AppError('Invalid email format', 400));
    if (Object.keys(updates).length === 0) return next(new AppError('No valid fields to update', 400));

    const user = await User.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true, runValidators: true }).select('-password -refreshToken -currentSessionToken');
    if (!user) return next(new AppError('User not found', 404));

    res.status(200).json({ success: true, message: 'User updated successfully', user });
  } catch (error) { next(error); }
};

exports.deleteUser = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return next(new AppError('Invalid user ID', 400));
    if (req.params.id === req.user._id.toString()) return next(new AppError('You cannot delete your own account', 400));
    const user = await User.findById(req.params.id);
    if (!user) return next(new AppError('User not found', 404));
    await User.findByIdAndDelete(req.params.id);
    logger.warn('User deleted', { deletedUserId: user._id, adminId: req.user._id });
    res.status(200).json({ success: true, message: 'User deleted successfully' });
  } catch (error) { next(error); }
};

// ========== USER: PROFILE ==========

exports.updateProfile = async (req, res) => {
  try {
    const { fullName, username, email, avatar } = req.body;
    const updates = {};
    if (fullName) updates.fullName = fullName;
    if (email) updates.email = email;
    if (avatar) updates.avatar = avatar;
    if (username) {
      const existing = await User.findOne({ username, _id: { $ne: req.user.id } });
      if (existing) return res.status(400).json({ success: false, message: 'Username taken' });
      updates.username = username;
    }
    const user = await User.findByIdAndUpdate(req.user.id, updates, { new: true });
    res.json({ success: true, user });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user.id).select('+password');
    const match = await user.comparePassword(currentPassword);
    if (!match) return res.status(401).json({ message: 'Current password is incorrect' });
    user.password = newPassword;
    await user.save();
    res.json({ success: true, message: 'Password changed' });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// ========== USER: TRANSFER ==========

exports.findUserByPhone = async (req, res) => {
  try {
    const user = await User.findOne({ phone: req.body.phone }).select('fullName phone');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user._id.toString() === req.user.id) return res.status(400).json({ success: false, message: 'Cannot transfer to yourself' });
    res.json({ success: true, user: { fullName: user.fullName, phone: user.phone } });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.transferBalance = async (req, res) => {
  try {
    const { recipientPhone, amount, password } = req.body;
    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount < 10) return res.status(400).json({ message: 'Minimum transfer is 10 ETB' });

    const sender = await User.findById(req.user.id).select('+password');
    const match = await sender.comparePassword(password);
    if (!match) return res.status(400).json({ message: 'Invalid password' });
    if ((sender.walletBalance || 0) < numAmount) return res.status(400).json({ message: 'Insufficient balance' });

    const recipient = await User.findOne({ phone: recipientPhone });
    if (!recipient) return res.status(404).json({ message: 'Recipient not found' });

    const senderBefore = sender.walletBalance || 0;
    const recipientBefore = recipient.walletBalance || 0;
    const senderAfter = senderBefore - numAmount;
    const recipientAfter = recipientBefore + numAmount;

    sender.walletBalance = senderAfter;
    recipient.walletBalance = recipientAfter;
    await sender.save();
    await recipient.save();

    const ref = `TRF-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

    await Transaction.create({ userId: sender._id, type: 'transfer_out', amount: -numAmount, balanceBefore: senderBefore, balanceAfter: senderAfter, direction: 'debit', status: 'completed', description: `Transfer to ${recipient.fullName || recipient.phone}`, reference: ref, performedBy: sender._id, performedByRole: 'user', metadata: { recipientId: recipient._id, recipientPhone, recipientName: recipient.fullName } });

    await Transaction.create({ userId: recipient._id, type: 'transfer_in', amount: numAmount, balanceBefore: recipientBefore, balanceAfter: recipientAfter, direction: 'credit', status: 'completed', description: `Transfer from ${sender.fullName || sender.phone}`, reference: ref, performedBy: sender._id, performedByRole: 'user', metadata: { senderId: sender._id, senderPhone: sender.phone, senderName: sender.fullName } });

    await Notification.create({ user: sender._id, type: 'payment', title: '💸 Transfer Sent', message: `${numAmount.toLocaleString()} ETB sent to ${recipient.fullName || recipient.phone}. New balance: ${senderAfter.toLocaleString()} ETB`, priority: 'high', amount: numAmount });
    await Notification.create({ user: recipient._id, type: 'payment', title: '💰 Transfer Received', message: `${numAmount.toLocaleString()} ETB received from ${sender.fullName || sender.phone}. New balance: ${recipientAfter.toLocaleString()} ETB`, priority: 'high', amount: numAmount });

    await User.findByIdAndUpdate(sender._id, { $inc: { unreadNotifications: 1 } });
    await User.findByIdAndUpdate(recipient._id, { $inc: { unreadNotifications: 1 } });

    logger.money('Balance transferred', { senderId: sender._id, recipientId: recipient._id, amount: numAmount });

    const io = req.app.get('io');
    if (io) {
      io.to(`user-${sender._id}`).emit('balanceUpdated', { balance: senderAfter });
      io.to(`user-${recipient._id}`).emit('balanceUpdated', { balance: recipientAfter });
    }

    res.json({ success: true, newBalance: senderAfter, walletBalance: senderAfter, amount: numAmount, recipient: { name: recipient.fullName, phone: recipient.phone } });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// ========== USER: FAVORITES ==========

exports.addFavoriteCartela = async (req, res) => {
  try {
    const { displayId } = req.body;
    const user = await User.findById(req.user.id);
    const exists = user.favoriteCartelas?.find(c => c.displayId === displayId);
    if (exists) return res.status(400).json({ success: false, message: 'Already favorited' });
    if (user.favoriteCartelas?.length >= 10) return res.status(400).json({ success: false, message: 'Max 10 favorites' });
    const card = await Card.findOne({ displayId, status: 'preview' });
    if (!card) return res.status(404).json({ success: false, message: 'Card not found' });
    user.favoriteCartelas.push({ displayId, cardId: card._id });
    await user.save();
    res.json({ success: true, message: 'Cartela saved as favorite' });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.getFavoriteCartelas = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const favorites = user.favoriteCartelas || [];
    const cardIds = favorites.map(f => f.cardId);
    const cards = await Card.find({ _id: { $in: cardIds } });
    const result = favorites.map(f => {
      const card = cards.find(c => c._id.toString() === f.cardId?.toString());
      return { displayId: f.displayId, cardId: f.cardId, savedAt: f.savedAt, card: card || null };
    });
    res.json({ success: true, favorites: result });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.removeFavoriteCartela = async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user.id, { $pull: { favoriteCartelas: { displayId: parseInt(req.params.displayId) } } });
    res.json({ success: true, message: 'Removed from favorites' });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// ========== USER: LIMITS & TELEGRAM ==========

exports.getLimits = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('spendingLimits');
    res.json({ success: true, limits: user?.spendingLimits || { enabled: false, daily: 0, weekly: 0, monthly: 0 } });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.updateLimits = async (req, res) => {
  try {
    const { enabled, daily, weekly, monthly } = req.body;
    const user = await User.findByIdAndUpdate(req.user.id, { spendingLimits: { enabled: enabled || false, daily: daily || 0, weekly: weekly || 0, monthly: monthly || 0 } }, { new: true });
    res.json({ success: true, message: 'Limits updated', limits: user.spendingLimits });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.linkTelegram = async (req, res) => {
  try {
    const { chatId } = req.body;
    const user = await User.findByIdAndUpdate(req.user.id, { telegramChatId: chatId }, { new: true });
    res.json({ success: true, message: 'Telegram linked', telegramChatId: user.telegramChatId });
  } catch (e) { res.status(500).json({ error: e.message }); }
};