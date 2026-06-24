const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  addBalance, deductBalance,
  getUserTransactions, getReconciliation, getAllTransactions,
  getUserNotifications, markNotificationRead, markAllNotificationsRead,
  getWithdrawals,
} = require('../controllers/financeController');

// Balance management
router.post('/users/:userId/add-balance', protect, authorize('superadmin', 'admin', 'finance'), addBalance);
router.post('/users/:userId/deduct-balance', protect, authorize('superadmin', 'admin', 'finance'), deductBalance);

// Transactions
router.get('/users/:userId/transactions', protect, authorize('superadmin', 'admin', 'finance'), getUserTransactions);
router.get('/transactions', protect, authorize('superadmin', 'admin', 'finance'), getAllTransactions);
router.get('/reconciliation', protect, authorize('superadmin', 'admin', 'finance'), getReconciliation);

// Withdrawals
router.get('/withdrawals', protect, authorize('superadmin', 'admin', 'finance'), getWithdrawals);

// Notifications
router.get('/users/:userId/notifications', protect, getUserNotifications);
router.put('/notifications/:notificationId/read', protect, markNotificationRead);
router.put('/users/:userId/notifications/read-all', protect, markAllNotificationsRead);

module.exports = router;
