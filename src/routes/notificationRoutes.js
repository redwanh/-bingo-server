const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const { protect } = require('../middleware/auth');

// Get user notifications
router.get('/', protect, async (req, res) => {
  const notifications = await Notification.find({ user: req.user.id })
    .sort({ createdAt: -1 })
    .limit(20);
  res.json({ success: true, notifications });
});

// Mark as read
router.put('/:id/read', protect, async (req, res) => {
  await Notification.findByIdAndUpdate(req.params.id, { isRead: true });
  res.json({ success: true });
});

// Admin: Send broadcast notification
router.post('/broadcast', protect, require('../middleware/auth').authorize('admin','superadmin'), async (req, res) => {
  const User = require('../models/User');
  const users = await User.find({ isActive: true });
  const notifications = users.map(u => ({
    user: u._id,
    message: req.body.message,
    type: 'broadcast'
  }));
  await Notification.insertMany(notifications);
  res.json({ success: true, sent: notifications.length });
});

module.exports = router;

