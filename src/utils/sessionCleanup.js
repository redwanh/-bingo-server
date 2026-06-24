
// server/src/utils/sessionCleanup.js
const User = require('../models/User');

// Cleanup expired sessions (run this periodically)
const cleanupExpiredSessions = async () => {
  try {
    const jwt = require('jsonwebtoken');
    const users = await User.find({ currentSessionToken: { $ne: null } });
    
    let cleaned = 0;
    for (const user of users) {
      try {
        jwt.verify(user.currentSessionToken, process.env.JWT_SECRET);
      } catch (error) {
        // Token is expired, clear it
        user.currentSessionToken = null;
        await user.save();
        cleaned++;
      }
    }
    
    console.log(`🧹 Cleaned up ${cleaned} expired sessions`);
    return cleaned;
  } catch (error) {
    console.error('Session cleanup error:', error);
    return 0;
  }
};

// Run cleanup every hour
setInterval(cleanupExpiredSessions, 60 * 60 * 1000);

module.exports = { cleanupExpiredSessions };