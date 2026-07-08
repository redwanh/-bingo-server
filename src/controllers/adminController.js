const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Notification = require('../models/Notification');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

// Constants
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;
const MAX_SEARCH_LENGTH = 100;
const ALLOWED_ROLES = ['user', 'admin', 'superadmin', 'finance', 'game'];
const isValidObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(id);
const MAX_DEPOSIT = 5000;

// Sanitize search input
const sanitizeSearch = (search) => {
  if (!search || typeof search !== 'string') return '';
  return search.slice(0, MAX_SEARCH_LENGTH).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').trim();
};

// ========== BALANCE MANAGEMENT ==========

// @desc    Add balance to user (creates transaction + notification)
// @route   POST /api/admin/users/:id/balance
exports.addBalance = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return next(new AppError('Invalid user ID', 400));
    }

    const { amount, description } = req.body;
    const numAmount = parseFloat(amount);

    if (!amount || isNaN(numAmount) || numAmount <= 0) {
      return next(new AppError('Please provide a valid positive amount', 400));
    }

    if (numAmount > MAX_DEPOSIT) {
      return next(new AppError(`Maximum single deposit is ${MAX_DEPOSIT.toLocaleString()}`, 400));
    }

    if (req.params.id === req.user._id.toString()) {
      return next(new AppError('You cannot modify your own balance', 400));
    }

    const user = await User.findById(req.params.id);
    if (!user) return next(new AppError('User not found', 404));

    const balanceBefore = user.walletBalance || 0;
    const balanceAfter = balanceBefore + numAmount;

    // 🔥 Update user balance
    user.walletBalance = balanceAfter;
    await user.save();

    // 🔥 Create transaction record
    const transaction = await Transaction.create({
      userId: user._id,
      type: 'admin_deposit',
      amount: numAmount,
      balanceBefore,
      balanceAfter,
      direction: 'credit',
      status: 'completed',
      description: description || `Admin deposit by ${req.user.fullName || req.user.phone}`,
      performedBy: req.user._id,
      performedByRole: req.user.role,
    });

    // 🔥 Create notification for the user
    await Notification.create({
      user: user._id,
      type: 'balance',
      title: '💰 Balance Added',
      message: `${numAmount.toLocaleString()} has been added to your account. New balance: ${balanceAfter.toLocaleString()}`,
      priority: 'normal',
      amount: numAmount,
      transactionId: transaction._id,
    });

    // Increment unread count
    await User.findByIdAndUpdate(user._id, { $inc: { unreadNotifications: 1 } });

    // Log
    logger.money('Admin deposit', {
      adminId: req.user._id,
      adminName: req.user.fullName || req.user.phone,
      userId: user._id,
      userName: user.fullName || user.phone,
      amount: numAmount,
      balanceBefore,
      balanceAfter,
      transactionId: transaction._id,
    });

    res.status(200).json({
      success: true,
      message: `Added ${numAmount.toLocaleString()} to ${user.fullName || user.phone}`,
      data: { balanceBefore, balanceAfter, amount: numAmount, transaction },
    });
  } catch (error) {
    logger.error('Add balance failed', { error: error.message });
    next(error);
  }
};

// @desc    Charge/deduct from user (creates transaction + notification)
// @route   POST /api/admin/users/:id/charge
exports.chargeUser = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return next(new AppError('Invalid user ID', 400));
    }

    const { amount, description } = req.body;
    const numAmount = parseFloat(amount);

    if (!amount || isNaN(numAmount) || numAmount <= 0) {
      return next(new AppError('Please provide a valid positive amount', 400));
    }

    const user = await User.findById(req.params.id);
    if (!user) return next(new AppError('User not found', 404));

    const balanceBefore = user.walletBalance || 0;

    if (balanceBefore < numAmount) {
      return next(new AppError(`Insufficient balance. Current: ${balanceBefore.toLocaleString()}`, 400));
    }

    const balanceAfter = balanceBefore - numAmount;
    user.walletBalance = balanceAfter;
    await user.save();

    // 🔥 Create transaction record
    const transaction = await Transaction.create({
      userId: user._id,
      type: 'admin_charge',
      amount: -numAmount,
      balanceBefore,
      balanceAfter,
      direction: 'debit',
      status: 'completed',
      description: description || `Admin charge by ${req.user.fullName || req.user.phone}`,
      performedBy: req.user._id,
      performedByRole: req.user.role,
    });

    // 🔥 Create notification
    await Notification.create({
      user: user._id,
      type: 'balance',
      title: '💸 Balance Deducted',
      message: `${numAmount.toLocaleString()} has been deducted from your account. New balance: ${balanceAfter.toLocaleString()}`,
      priority: 'high',
      amount: numAmount,
      transactionId: transaction._id,
    });

    // Increment unread count
    await User.findByIdAndUpdate(user._id, { $inc: { unreadNotifications: 1 } });

    // Log
    logger.money('Admin charge', {
      adminId: req.user._id,
      adminName: req.user.fullName || req.user.phone,
      userId: user._id,
      userName: user.fullName || user.phone,
      amount: -numAmount,
      balanceBefore,
      balanceAfter,
      transactionId: transaction._id,
    });

    res.status(200).json({
      success: true,
      message: `Deducted ${numAmount.toLocaleString()} from ${user.fullName || user.phone}`,
      data: { balanceBefore, balanceAfter, amount: numAmount, transaction },
    });
  } catch (error) {
    logger.error('Charge user failed', { error: error.message });
    next(error);
  }
};

// ========== USER MANAGEMENT ==========

// @desc    Get all users
// @route   GET /api/admin/users
exports.getAllUsers = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.limit) || DEFAULT_PAGE_SIZE));
    const skip = (page - 1) * limit;
    const filter = {};

    if (req.query.search) {
      const safeSearch = sanitizeSearch(req.query.search);
      if (safeSearch) {
        filter.$or = [
          { phone: { $regex: safeSearch, $options: 'i' } },
          { fullName: { $regex: safeSearch, $options: 'i' } },
          { username: { $regex: safeSearch, $options: 'i' } },
          { email: { $regex: safeSearch, $options: 'i' } },
        ];
      }
    }

    if (req.query.role && ALLOWED_ROLES.includes(req.query.role)) filter.role = req.query.role;
    if (req.query.isActive !== undefined) filter.isActive = req.query.isActive === 'true';

    const sortMap = {
      'newest': { createdAt: -1 }, 'oldest': { createdAt: 1 },
      'name': { fullName: 1 }, 'balance_high': { walletBalance: -1 },
      'balance_low': { walletBalance: 1 }, 'role': { role: 1 },
    };
    const sort = sortMap[req.query.sort] || { createdAt: -1 };

    const [users, total] = await Promise.all([
      User.find(filter).select('-password -refreshToken -currentSessionToken -loginAttempts -otpCode').sort(sort).skip(skip).limit(limit).lean(),
      User.countDocuments(filter),
    ]);

    res.set('Cache-Control', 'private, max-age=30');

    res.status(200).json({
      success: true, users,
      pagination: { page, limit, total, pages: Math.ceil(total / limit), hasNextPage: page < Math.ceil(total / limit), hasPrevPage: page > 1 },
    });
  } catch (error) {
    logger.error('Failed to fetch users', { error: error.message });
    next(error);
  }
};

// @desc    Get single user
exports.getUser = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return next(new AppError('Invalid user ID', 400));
    const user = await User.findById(req.params.id).select('-password -refreshToken -currentSessionToken');
    if (!user) return next(new AppError('User not found', 404));
    res.set('Cache-Control', 'private, max-age=60');
    res.status(200).json({ success: true, user });
  } catch (error) { next(error); }
};

// @desc    Update user
exports.updateUser = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) return next(new AppError('Invalid user ID', 400));
    const allowedUpdates = ['fullName', 'username', 'email', 'role', 'isActive', 'walletBalance'];
    const updates = {};
    for (const field of Object.keys(req.body)) {
      if (allowedUpdates.includes(field)) updates[field] = req.body[field];
    }
    if (updates.role && !ALLOWED_ROLES.includes(updates.role)) return next(new AppError('Invalid role', 400));
    if (updates.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.email)) return next(new AppError('Invalid email format', 400));
    if (Object.keys(updates).length === 0) return next(new AppError('No valid fields to update', 400));

    const user = await User.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true, runValidators: true }).select('-password -refreshToken -currentSessionToken');
    if (!user) return next(new AppError('User not found', 404));

    res.status(200).json({ success: true, message: 'User updated successfully', user });
  } catch (error) { next(error); }
};

// @desc    Delete user
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