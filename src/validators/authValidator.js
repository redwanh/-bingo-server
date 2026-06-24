const { body } = require('express-validator');

const registerValidation = [
  body('phone')
    .matches(/^\+\d{10,15}$/)
    .withMessage('Phone must be in international format (+251912345678)'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters'),
  body('fullName')
    .optional()
    .trim()
    .isLength({ min: 2 })
    .withMessage('Name must be at least 2 characters')
];

const loginValidation = [
  body('phone')
    .matches(/^\+\d{10,15}$/)
    .withMessage('Valid phone number required'),
  body('password')
    .notEmpty()
    .withMessage('Password is required')
];

const otpValidation = [
  body('phone')
    .matches(/^\+\d{10,15}$/)
    .withMessage('Valid phone number required')
];

const verifyOtpValidation = [
  body('phone')
    .matches(/^\+\d{10,15}$/)
    .withMessage('Valid phone number required'),
  body('code')
    .isLength({ min: 4, max: 6 })
    .withMessage('Valid OTP code required')
];

module.exports = {
  registerValidation,
  loginValidation,
  otpValidation,
  verifyOtpValidation
};

