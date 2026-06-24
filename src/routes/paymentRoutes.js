const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  getPaymentAccounts, getAllPaymentAccounts,
  createPaymentAccount, updatePaymentAccount, deletePaymentAccount,
  createDeposit, createWithdrawal,
  getDepositRequests, approveDeposit, rejectDeposit,
  approveWithdrawal, rejectWithdrawal,
  seedPaymentAccounts,
} = require('../controllers/paymentController');

// Public — get active payment accounts
router.get('/accounts', getPaymentAccounts);

// Admin — manage payment accounts
router.get('/admin/accounts', protect, authorize('superadmin', 'admin', 'finance'), getAllPaymentAccounts);
router.post('/admin/accounts', protect, authorize('superadmin', 'admin', 'finance'), createPaymentAccount);
router.put('/admin/accounts/:id', protect, authorize('superadmin', 'admin', 'finance'), updatePaymentAccount);
router.delete('/admin/accounts/:id', protect, authorize('superadmin', 'admin', 'finance'), deletePaymentAccount);

// Player — deposit & withdraw
router.post('/deposit', protect, createDeposit);
router.post('/withdraw', protect, createWithdrawal);

// Admin — manage deposits & withdrawals
router.get('/deposits', protect, authorize('superadmin', 'admin', 'finance'), getDepositRequests);
router.put('/deposits/:id/approve', protect, authorize('superadmin', 'admin', 'finance'), approveDeposit);
router.put('/deposits/:id/reject', protect, authorize('superadmin', 'admin', 'finance'), rejectDeposit);
router.put('/withdrawals/:id/approve', protect, authorize('superadmin', 'admin', 'finance'), approveWithdrawal);
router.put('/withdrawals/:id/reject', protect, authorize('superadmin', 'admin', 'finance'), rejectWithdrawal);

// Seed
router.post('/seed', protect, authorize('superadmin'), seedPaymentAccounts);

module.exports = router;
