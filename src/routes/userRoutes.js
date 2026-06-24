const express = require('express');
const router = express.Router();
const { updateProfile, changePassword, linkTelegram } = require('../controllers/userController');
const { protect } = require('../middleware/auth');

router.use(protect);
router.put('/profile', updateProfile);
router.put('/change-password', changePassword);
router.put('/link-telegram', linkTelegram);

module.exports = router;
