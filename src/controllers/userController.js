const User = require('../models/User');
const AppError = require('../utils/AppError');
const Transaction = require('../models/Transaction'); 
const Card = require('../models/Card');  // ← ADD THIS


// @desc    Update profile
// @route   PUT /api/users/profile
exports.updateProfile = async (req, res, next) => {
  try {
    const { fullName, username, email, avatar } = req.body;
    
    const updates = {};
    if (fullName) updates.fullName = fullName;
    if (email) updates.email = email;
    if (avatar) updates.avatar = avatar;

    if (username) {
      const existing = await User.findOne({ username, _id: { $ne: req.user.id } });
      if (existing) {
        return next(new AppError('Username already taken', 400));
      }
      updates.username = username;
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      updates,
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: 'Profile updated',
      user
    });
  } catch (error) {
    next(error);
  }
};

exports.findUserByPhone = async (req, res) => {
  try {
    const user = await User.findOne({ phone: req.body.phone })
      .select('fullName phone');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user._id.toString() === req.user.id) return res.status(400).json({ success: false, message: 'Cannot transfer to yourself' });
    res.json({ success: true, user: { fullName: user.fullName, phone: user.phone } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.transferBalance = async (req, res) => {
  try {
    const { recipientPhone, amount, password } = req.body;
    
    // Verify sender password
    const sender = await User.findById(req.user.id).select('+password');
    const isMatch = await sender.comparePassword(password);
    if (!isMatch) return res.status(400).json({ success: false, message: 'Invalid password' });
    
    if (sender.walletBalance < amount) {
      return res.status(400).json({ success: false, message: 'Insufficient balance' });
    }
    
    const recipient = await User.findOne({ phone: recipientPhone });
    if (!recipient) return res.status(404).json({ success: false, message: 'Recipient not found' });
    
    // Use findByIdAndUpdate to avoid session issues
    await User.findByIdAndUpdate(req.user.id, { $inc: { walletBalance: -amount } });
    await User.findByIdAndUpdate(recipient._id, { $inc: { walletBalance: amount } });
    
    // Get updated balance
    const updatedSender = await User.findById(req.user.id);
    
    // Create transactions
    await Transaction.create({ 
      userId: sender._id, type: 'transfer_out', amount: -amount, 
      description: `Transfer to ${recipient.fullName}`, balanceAfter: updatedSender.walletBalance 
    });
    await Transaction.create({ 
      userId: recipient._id, type: 'transfer_in', amount: amount, 
      description: `Transfer from ${sender.fullName}`, balanceAfter: recipient.walletBalance + amount 
    });
    
    res.json({ success: true, newBalance: updatedSender.walletBalance });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// @desc    Change password
// @route   PUT /api/users/change-password
exports.changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user.id).select('+password');
    
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return next(new AppError('Current password is incorrect', 401));
    }

    user.password = newPassword;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    next(error);
  }
};
exports.addFavoriteCartela = async (req, res) => {
  try {
    const { displayId } = req.body;
    const user = await User.findById(req.user.id);
    
    // Check if already favorited
    const exists = user.favoriteCartelas?.find(c => c.displayId === displayId);
    if (exists) return res.status(400).json({ success: false, message: 'Already favorited' });
    
    // Check if card exists
    const card = await Card.findOne({ displayId, status: 'preview' });
    if (!card) return res.status(404).json({ success: false, message: 'Card not found' });
    
    // Max 10 favorites
    if (user.favoriteCartelas?.length >= 10) {
      return res.status(400).json({ success: false, message: 'Max 10 favorites' });
    }
    
    user.favoriteCartelas.push({ displayId, cardId: card._id });
    await user.save();
    
    res.json({ success: true, message: 'Cartela saved as favorite' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.getFavoriteCartelas = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const favorites = user.favoriteCartelas || [];
    
    // Get card details
    const cardIds = favorites.map(f => f.cardId);
    const cards = await Card.find({ _id: { $in: cardIds } });
    
    const result = favorites.map(f => {
      const card = cards.find(c => c._id.toString() === f.cardId?.toString());
      return {
        displayId: f.displayId,
        cardId: f.cardId,
        savedAt: f.savedAt,
        card: card || null,
      };
    });
    
    res.json({ success: true, favorites: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.removeFavoriteCartela = async (req, res) => {
  try {
    const displayId = parseInt(req.params.displayId);
    await User.findByIdAndUpdate(req.user.id, {
      $pull: { favoriteCartelas: { displayId } }
    });
    res.json({ success: true, message: 'Removed from favorites' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
exports.getLimits = async (req, res) => {
  const user = await User.findById(req.user.id).select('spendingLimits');
  res.json({ success: true, limits: user.spendingLimits || {} });
};

exports.updateLimits = async (req, res) => {
  const { enabled, daily, weekly, monthly } = req.body;
  await User.findByIdAndUpdate(req.user.id, {
    spendingLimits: { enabled, daily, weekly, monthly }
  });
  res.json({ success: true, message: 'Limits updated' });
};

// @desc    Link Telegram
// @route   PUT /api/users/link-telegram
exports.linkTelegram = async (req, res, next) => {
  try {
    const { chatId } = req.body;

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { telegramChatId: chatId },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: 'Telegram linked successfully',
      user
    });
  } catch (error) {
    next(error);
  }
};
