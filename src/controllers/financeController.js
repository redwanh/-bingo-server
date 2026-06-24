const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Withdrawal = require('../models/Withdrawal');
const Notification = require('../models/Notification');
const AppError = require('../utils/AppError');

// Add balance to user
exports.addBalance = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { amount, type = 'cash', description, reference } = req.body;
    if (!amount || amount <= 0) return next(new AppError('Amount must be positive', 400));
    const user = await User.findById(userId);
    if (!user) return next(new AppError('User not found', 404));
    const balanceBefore = user.walletBalance;
    user.walletBalance += parseFloat(amount);
    await user.save();
    const balanceAfter = user.walletBalance;
    const transaction = await Transaction.create({
      user: userId, userId: userId, type: type || 'cash', amount: parseFloat(amount),
      balanceBefore, balanceAfter, direction: 'credit', status: 'completed',
      performedBy: req.user._id, performedByRole: req.user.role,
      reference: reference || ('ADD-' + Date.now().toString(36).toUpperCase()),
      description: description || 'Balance added by ' + req.user.role,
    });
    await Notification.create({
      user: userId, type: 'balance_added', title: 'Balance Added 💰',
      message: '+' + parseFloat(amount) + ' ETB. New balance: ' + balanceAfter + ' ETB',
      priority: 'high', amount: parseFloat(amount), transactionId: transaction._id,
    });
    res.status(200).json({ success: true, data: { user: { _id: user._id, fullName: user.fullName, walletBalance: user.walletBalance }, transaction } });
  } catch (error) { next(error); }
};

// Deduct balance
exports.deductBalance = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { amount, type = 'adjustment', description } = req.body;
    if (!amount || amount <= 0) return next(new AppError('Amount must be positive', 400));
    const user = await User.findById(userId);
    if (!user) return next(new AppError('User not found', 404));
    if (user.walletBalance < amount) return next(new AppError('Insufficient balance', 400));
    const balanceBefore = user.walletBalance;
    user.walletBalance -= parseFloat(amount);
    await user.save();
    const balanceAfter = user.walletBalance;
    const transaction = await Transaction.create({
      user: userId, userId: userId, type, amount: parseFloat(amount),
      balanceBefore, balanceAfter, direction: 'debit', status: 'completed',
      performedBy: req.user._id, performedByRole: req.user.role,
      description: description || 'Balance deducted',
    });
    await Notification.create({
      user: userId, type: 'balance_deducted', title: 'Balance Deducted',
      message: '-' + parseFloat(amount) + ' ETB. New balance: ' + balanceAfter + ' ETB',
      priority: 'high', amount: parseFloat(amount), transactionId: transaction._id,
    });
    res.status(200).json({ success: true, data: { user: { _id: user._id, fullName: user.fullName, walletBalance: user.walletBalance }, transaction } });
  } catch (error) { next(error); }
};

// Get user transactions
exports.getUserTransactions = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20, type, startDate, endDate } = req.query;
    const query = { user: userId };
    if (type) query.type = type;
    if (userId) {
      const users = await User.find({ 
        $or: [
          { fullName: { $regex: userId, $options: 'i' } }, 
          { phone: { $regex: userId, $options: 'i' } }
        ] 
      }).select('_id');
      query.userId = { $in: users.map(u => u._id) };
    }
    if (startDate || endDate) { query.createdAt = {}; if (startDate) query.createdAt.$gte = new Date(startDate); if (endDate) query.createdAt.$lte = new Date(endDate); }
    const transactions = await Transaction.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(parseInt(limit)).populate('performedBy', 'fullName role');
    const total = await Transaction.countDocuments(query);
    res.status(200).json({ success: true, data: { transactions, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) } } });
  } catch (error) { next(error); }
};

// Get reconciliation
exports.getReconciliation = async (req, res, next) => {
  try {
    const { startDate, endDate, type, userId, accountType } = req.query;
    const query = {};
    if (startDate || endDate) { query.createdAt = {}; if (startDate) query.createdAt.$gte = new Date(startDate); if (endDate) query.createdAt.$lte = new Date(endDate); }
    if (type) query.type = type;
    if (userId) {
      const users = await User.find({ 
        $or: [
          { fullName: { $regex: userId, $options: 'i' } }, 
          { phone: { $regex: userId, $options: 'i' } }
        ] 
      }).select('_id');
      query.userId = { $in: users.map(u => u._id) };
    }
    const summary = await Transaction.aggregate([
      { $match: query },
      { $group: { _id: '$type', totalAmount: { $sum: '$amount' }, count: { $sum: 1 }, creditTotal: { $sum: { $cond: [{ $eq: ['$direction', 'credit'] }, '$amount', 0] } }, debitTotal: { $sum: { $cond: [{ $eq: ['$direction', 'debit'] }, '$amount', 0] } } } },
      { $sort: { _id: 1 } }
    ]);
    const totalCredit = await Transaction.aggregate([{ $match: { ...query, direction: 'credit' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]);
    const totalDebit = await Transaction.aggregate([{ $match: { ...query, direction: 'debit' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]);
    res.status(200).json({ success: true, data: { summary, totals: { credit: totalCredit[0]?.total || 0, debit: totalDebit[0]?.total || 0, net: (totalCredit[0]?.total || 0) - (totalDebit[0]?.total || 0) } } });
  } catch (error) { next(error); }
};

// Get withdrawals
exports.getWithdrawals = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const query = {};
    if (status && status !== 'all') query.status = status;
    const withdrawals = await Withdrawal.find(query).populate('user', 'fullName phone walletBalance').populate('reviewedBy', 'fullName').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(parseInt(limit));
    const total = await Withdrawal.countDocuments(query);
    res.status(200).json({ success: true, data: { withdrawals, total, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) } } });
  } catch (error) { next(error); }
};

// Notifications
exports.getUserNotifications = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20, unreadOnly } = req.query;
    const query = { user: userId };
    if (unreadOnly === 'true') query.isRead = false;
    const notifications = await Notification.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(parseInt(limit));
    const total = await Notification.countDocuments(query);
    const unreadCount = await Notification.countDocuments({ user: userId, isRead: false });
    res.status(200).json({ success: true, data: { notifications, unreadCount, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) } } });
  } catch (error) { next(error); }
};

exports.markNotificationRead = async (req, res, next) => {
  try {
    const { notificationId } = req.params;
    const notification = await Notification.findByIdAndUpdate(notificationId, { isRead: true, readAt: new Date() }, { new: true });
    if (!notification) return next(new AppError('Notification not found', 404));
    res.status(200).json({ success: true, data: notification });
  } catch (error) { next(error); }
};

exports.markAllNotificationsRead = async (req, res, next) => {
  try {
    const { userId } = req.params;
    await Notification.updateMany({ user: userId, isRead: false }, { isRead: true, readAt: new Date() });
    res.status(200).json({ success: true, message: 'All notifications marked as read' });
  } catch (error) { next(error); }
};




// Get all transactions for admin journal
exports.getAllTransactions = async (req, res, next) => {
  try {
    const { page = 1, limit = 50, type, userId, startDate, endDate } = req.query;
    const query = {};
    if (type && type !== 'all') query.type = type;
    if (startDate || endDate) { 
      query.createdAt = {}; 
      if (startDate) query.createdAt.$gte = new Date(startDate); 
      if (endDate) query.createdAt.$lte = new Date(endDate); 
    }
    
    // User filter — search by name or phone
    if (userId) {
      const users = await User.find({ 
        $or: [
          { fullName: { $regex: userId, $options: 'i' } }, 
          { phone: { $regex: userId, $options: 'i' } }
        ] 
      }).select('_id');
      const userIds = users.map(u => u._id);
      query.$or = [
        { user: { $in: userIds } }, 
        { userId: { $in: userIds } }
      ];
    }
    
    const transactions = await Transaction.find(query)
      .populate('user', 'fullName phone')
      .populate('userId', 'fullName phone')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    const total = await Transaction.countDocuments(query);
    
    res.status(200).json({ 
      success: true, 
      data: { 
        transactions, 
        pagination: { 
          page: parseInt(page), 
          limit: parseInt(limit), 
          total, 
          pages: Math.ceil(total / limit) 
        } 
      } 
    });
  } catch (error) { next(error); }
};
