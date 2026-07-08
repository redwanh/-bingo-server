const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  updateProfile,
  findUserByPhone,
  transferBalance,
  changePassword,
  addFavoriteCartela,
  getFavoriteCartelas,
  removeFavoriteCartela,
  getLimits,
  updateLimits,
  linkTelegram,
} = require('../controllers/userController');

// Profile
router.put('/profile', protect, updateProfile);
router.put('/change-password', protect, changePassword);

// Transfer
router.post('/transfer', protect, transferBalance);
router.post('/find-user', protect, findUserByPhone);

// Favorites
router.post('/favorites', protect, addFavoriteCartela);
router.get('/favorites', protect, getFavoriteCartelas);
router.delete('/favorites/:displayId', protect, removeFavoriteCartela);

// Limits
router.get('/limits', protect, getLimits);
router.put('/limits', protect, updateLimits);

// Telegram
router.put('/link-telegram', protect, linkTelegram);

module.exports = router;