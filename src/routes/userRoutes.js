const express = require('express');
const router = express.Router();
const { 
  updateProfile, changePassword, linkTelegram, 
  findUserByPhone, transferBalance, getLimits, updateLimits,
  addFavoriteCartela, getFavoriteCartelas, removeFavoriteCartela  // ← ADD THESE
} = require('../controllers/userController');
const { protect } = require('../middleware/auth');

router.use(protect);
router.put('/profile', updateProfile);
router.put('/change-password', changePassword);
router.put('/link-telegram', linkTelegram);
router.post('/find-by-phone', protect, findUserByPhone);
router.post('/transfer', protect, transferBalance);
router.put('/limits', protect, updateLimits);
router.get('/limits', protect, getLimits);
router.post('/favorite-cartela', protect, addFavoriteCartela);
router.get('/favorite-cartelas', protect, getFavoriteCartelas);
router.delete('/favorite-cartela/:displayId', protect, removeFavoriteCartela);

module.exports = router;