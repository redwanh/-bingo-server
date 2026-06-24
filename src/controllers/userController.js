const User = require('../models/User');
const AppError = require('../utils/AppError');

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
