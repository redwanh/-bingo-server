const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const {
  getAllUsers,
  getUser,
  updateUser,
  deleteUser,
  addBalance,      
  chargeUser,      
} = require('../controllers/adminController');
const { protect, authorize } = require('../middleware/auth');

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests' },
});

router.use(protect);
router.use(authorize('admin', 'superadmin'));
router.use(adminLimiter);

// User management
router.get('/users', getAllUsers);
router.get('/users/:id', getUser);
router.put('/users/:id', updateUser);
router.delete('/users/:id', authorize('superadmin'), deleteUser);

// Balance management (with transaction + notification)
router.post('/users/:id/balance', addBalance);    
router.post('/users/:id/charge', chargeUser);      

module.exports = router;