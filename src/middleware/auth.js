const { verifyAccessToken } = require('../utils/jwt');
const User = require('../models/User');
const AppError = require('../utils/AppError');

const protect = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    if (!token) return next(new AppError('Please log in', 401));

    // Clean token
    token = token.trim();

    const decoded = verifyAccessToken(token);
    const user = await User.findById(decoded.id);
    if (!user) return next(new AppError('User not found', 401));
    if (!user.isActive) return next(new AppError('Account deactivated', 403));

    // ✅ IMPROVED SESSION MANAGEMENT
    // Check if session tracking is enabled (you can make this configurable)
    const SESSION_CHECK_ENABLED = process.env.SESSION_CHECK_ENABLED !== 'false';
    
    if (SESSION_CHECK_ENABLED && user.currentSessionToken) {
      // If the token doesn't match, the user logged in elsewhere
      if (user.currentSessionToken !== token) {
        // Check if the old token is expired (grace period)
        try {
          // Try to verify the current session token
          const currentDecoded = verifyAccessToken(user.currentSessionToken);
          // If it's still valid, reject the old token
          return next(new AppError('Session expired - logged in on another device', 401));
        } catch (err) {
          // If the current session token is expired, accept the new token
          console.log('🔄 Old session expired, accepting new token');
          user.currentSessionToken = token;
          await user.save();
        }
      }
    } else {
      // If no session token exists, set it
      if (!user.currentSessionToken) {
        user.currentSessionToken = token;
        await user.save();
      }
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') return next(new AppError('Invalid token', 401));
    if (error.name === 'TokenExpiredError') return next(new AppError('Token expired', 401));
    next(error);
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return next(new AppError('Not authorized', 403));
    }
    next();
  };
};

module.exports = { protect, authorize };