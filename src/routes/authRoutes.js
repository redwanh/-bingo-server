const express = require('express');
const router = express.Router();
const {
  sendOTP, sendRegistrationOTP, sendLoginOTP,
  verifyOTP, getOTPStatus, lockAccount,
  register, login, refreshToken,
  forgotPassword, resetPassword, logout, getMe
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const validate = require('../middleware/validation');
const {
  registerValidation, loginValidation,
  otpValidation, verifyOtpValidation
} = require('../validators/authValidator');

// OTP routes
router.post('/send-otp', otpValidation, validate, sendOTP);
router.post('/send-registration-otp', otpValidation, validate, sendRegistrationOTP);
router.post('/send-login-otp', otpValidation, validate, sendLoginOTP);
router.post('/verify-otp', verifyOtpValidation, validate, verifyOTP);
router.get('/otp-status/:phone', getOTPStatus);

// Account lock
router.post('/lock-account', otpValidation, validate, lockAccount);

// Auth routes
router.post('/register', registerValidation, validate, register);
router.post('/login', loginValidation, validate, login);
router.post('/refresh-token', refreshToken);
router.post('/forgot-password', otpValidation, validate, forgotPassword);
router.post('/reset-password', resetPassword);

// Protected
router.post('/logout', protect, logout);
router.get('/me', protect, getMe);

module.exports = router;
