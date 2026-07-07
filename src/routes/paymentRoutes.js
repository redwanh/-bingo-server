const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  getPaymentAccounts,
  getAllPaymentAccounts,
  createPaymentAccount,
  updatePaymentAccount,
  deletePaymentAccount,
  createDeposit,
  createWithdrawal,
  approveWithdrawal,
  rejectWithdrawal,
  seedPaymentAccounts,
} = require('../controllers/paymentController');

// ─── PUBLIC (authenticated users) ───
router.use(protect);

// Payment accounts (read-only for users)
router.get('/accounts', getPaymentAccounts);

// Deposit & Withdraw
router.post('/deposit', createDeposit);
router.post('/withdraw', createWithdrawal);

// ─── ADMIN ONLY ───
router.use(authorize('admin', 'superadmin', 'finance'));

// Manage payment accounts
router.get('/admin/accounts', getAllPaymentAccounts);
router.post('/admin/accounts', createPaymentAccount);
router.put('/admin/accounts/:id', updatePaymentAccount);
router.delete('/admin/accounts/:id', deletePaymentAccount);

// 🔥 FIXED: Withdrawal management routes (match frontend)
router.put('/withdrawals/:id/approve', approveWithdrawal);   // was /admin/withdrawals/:id/approve
router.put('/withdrawals/:id/reject', rejectWithdrawal);     // was /admin/withdrawals/:id/reject

// Seed sample data
router.post('/seed', seedPaymentAccounts);

module.exports = router;