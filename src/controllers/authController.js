const User = require('../models/User');
const Otp = require('../models/Otp');
const RefreshToken = require('../models/RefreshToken');
const otpService = require('../services/otpService');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const AppError = require('../utils/AppError');
const { OAuth2Client } = require('google-auth-library');

// ============================================
// HELPERS
// ============================================

/**
 * Generate auth tokens and save refresh token to DB
 */
const generateAndSaveTokens = async (user) => {
  const accessToken = generateAccessToken(user._id, user.role);
  const refreshToken = generateRefreshToken(user._id);
  
  console.log('🔍 [SAVE] Token being saved:', refreshToken);
  console.log('🔍 [SAVE] Token length:', refreshToken.length);
  
  await RefreshToken.create({
    token: refreshToken,
    user: user._id,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  console.log('🔍 [SAVE] User ID type:', typeof user._id);
console.log('🔍 [SAVE] User ID:', user._id);
console.log('🔍 [SAVE] User ID string:', user._id.toString());
  console.log('🔍 [SAVE] ✅ Saved successfully');
  
  return { accessToken, refreshToken };
};
/**
 * Sanitize user object - remove sensitive fields
 */
const sanitizeUser = (user) => {
  const obj = user.toObject ? user.toObject() : { ...user };
  delete obj.password;
  delete obj.currentSessionToken;
  delete obj.__v;
  return obj;
};

// ============================================
// OTP: REGISTRATION
// ============================================

exports.sendRegistrationOTP = async (req, res, next) => {
  try {
    const { phone, channel } = req.body;

    const existingUser = await User.findOne({ phone });
    if (existingUser) {
      return next(new AppError('PHONE_EXISTS', 400));
    }

    const result = await otpService.sendOTP(phone, 'registration', channel || 'test');

    res.status(200).json({
      success: true,
      ...result,
      code: process.env.NODE_ENV !== 'production' ? result.code : undefined,
    });
  } catch (error) {
    if (error.statusCode) return next(error);
    next(new AppError(error.message, error.statusCode || 500));
  }
};

// ============================================
// OTP: LOGIN / FORGOT PASSWORD
// ============================================

exports.sendLoginOTP = async (req, res, next) => {
  try {
    const { phone, channel } = req.body;

    const user = await User.findOne({ phone }).select('+password +loginAttempts +lockUntil');
    if (!user) {
      return next(new AppError('PHONE_NOT_FOUND', 400));
    }

    // Check if account is locked
    if (user.lockUntil && user.lockUntil > new Date()) {
      const waitMs = user.lockUntil.getTime() - Date.now();
      const waitSeconds = Math.ceil(waitMs / 1000);
      const waitMinutes = Math.ceil(waitSeconds / 60);

      return res.status(423).json({
        success: false,
        errorCode: 'ACCOUNT_LOCKED',
        message: `Account locked. Please wait ${waitMinutes}m ${waitSeconds % 60}s.`,
        retryAfterSeconds: waitSeconds,
        lockUntil: user.lockUntil,
      });
    }

    // Auto-unlock if lock expired
    if (user.lockUntil && user.lockUntil <= new Date()) {
      user.loginAttempts = 0;
      user.lockUntil = undefined;
      await user.save();
    }

    const result = await otpService.sendOTP(phone, 'reset_password', channel || 'test');

    res.status(200).json({
      success: true,
      ...result,
      code: process.env.NODE_ENV !== 'production' ? result.code : undefined,
    });
  } catch (error) {
    if (error.statusCode) return next(error);
    next(new AppError(error.message, error.statusCode || 500));
  }
};

// ============================================
// OTP: GENERIC SEND
// ============================================

exports.sendOTP = async (req, res, next) => {
  try {
    const { phone } = req.body;
    const user = await User.findOne({ phone }).select('+password +loginAttempts +lockUntil');
    if (!user) {
      return res.status(200).json({ success: true, message: 'If registered, OTP sent' });
    }

    const result = await otpService.sendOTP(phone, 'authentication');

    res.status(200).json({
      success: true,
      ...result,
      code: process.env.NODE_ENV !== 'production' ? result.code : undefined,
    });
  } catch (error) {
    if (error.statusCode) return next(error);
    next(new AppError(error.message, error.statusCode || 500));
  }
};

// ============================================
// OTP: VERIFY
// ============================================

exports.verifyOTP = async (req, res, next) => {
  try {
    const { phone, code } = req.body;
    const result = await otpService.verifyOTP(phone, code);

    if (!result.success) {
      return next(new AppError(result.message, 400));
    }

    const user = await User.findOne({ phone }).select('+password +loginAttempts +lockUntil');

    res.status(200).json({
      success: true,
      message: 'OTP verified',
      isNewUser: !user,
      purpose: result.purpose,
    });
  } catch (error) {
    next(error);
  }
};

// ============================================
// OTP: STATUS
// ============================================

exports.getOTPStatus = async (req, res, next) => {
  try {
    const { phone } = req.params;
    const status = await otpService.getOTPStatus(phone);
    res.status(200).json({ success: true, ...status });
  } catch (error) {
    next(error);
  }
};

// ============================================
// AUTH: REGISTER
// ============================================

exports.register = async (req, res, next) => {
  try {
    const { phone, password, fullName, username, otpCode } = req.body;

    // Check phone uniqueness
    const existingUser = await User.findOne({ phone });
    if (existingUser) {
      return next(new AppError('User already exists', 400));
    }

    // Verify OTP if provided
    if (otpCode) {
      const otpResult = await otpService.verifyOTP(phone, otpCode);
      if (!otpResult.success) {
        return next(new AppError('Invalid or expired OTP', 400));
      }
    }

    // Check username uniqueness
    if (username) {
      const existingUsername = await User.findOne({ username });
      if (existingUsername) {
        return next(new AppError('Username taken', 400));
      }
    }

    // Create user
    const user = await User.create({
      phone,
      password,
      fullName: fullName || 'User_' + phone.slice(-4),
      username: username || 'user_' + phone.slice(-4) + '_' + Date.now().toString(36),
      isVerified: true,
    });

    // Generate tokens
    const { accessToken, refreshToken } = await generateAndSaveTokens(user);

    user.currentSessionToken = accessToken;
    user.lastLogin = new Date();
    user.lastActive = new Date();
    await user.save();

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      accessToken,
      refreshToken,
      user: sanitizeUser(user),
    });
  } catch (error) {
    next(error);
  }
};

// ============================================
// AUTH: LOGIN
// ============================================

exports.login = async (req, res) => {
  try {
    const { phone, password } = req.body;

    // Find user
    const user = await User.findOne({ phone }).select('+password +loginAttempts +lockUntil');
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      user.loginAttempts = (user.loginAttempts || 0) + 1;

      // Lock account after 5 failed attempts
      if (user.loginAttempts >= 5) {
        user.isActive = false;
        await user.save();
        return res.status(401).json({
          success: false,
          message: 'Account locked due to too many failed attempts',
        });
      }

      await user.save();
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Check if account is active
    if (!user.isActive) {
      return res.status(401).json({ success: false, message: 'Account deactivated' });
    }

    // Reset login attempts on success
    user.loginAttempts = 0;

   

    // 🔥 FIRST: Revoke old tokens
    await RefreshToken.updateMany(
      { user: user._id, isRevoked: false },
      { isRevoked: true }
    );

    // 🔥 THEN: Generate and save new tokens
    const { accessToken, refreshToken } = await generateAndSaveTokens(user);

    user.currentSessionToken = accessToken;
    user.lastLogin = new Date();
    await user.save();

    res.json({
      success: true,
      message: 'Login successful',
      accessToken,
      refreshToken,
      user: sanitizeUser(user),
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ============================================
// AUTH: GOOGLE
// ============================================

exports.googleAuth = async (req, res) => {
  try {
    const { code, phone, fullName, password } = req.body;

    if (!code) {
      return res.status(400).json({ success: false, message: 'No code provided' });
    }

    const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001'
);

    // Exchange code for tokens
    const { tokens } = await googleClient.getToken(code);
    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { email, name, sub: googleId } = payload;

    // Find or create user
    let user = await User.findOne({ $or: [{ email }, { phone }] });
    let isNewUser = false;

    if (!user) {
      user = await User.create({
        email,
        fullName: fullName || name,
        phone: phone || 'google_' + googleId.substring(0, 10),
        googleId,
        password: password || 'google_' + Date.now().toString(36),
        isVerified: true,
        username: email.split('@')[0] + '_' + Date.now().toString(36),
      });
      isNewUser = true;
    }

    // Generate tokens
    const { accessToken, refreshToken } = await generateAndSaveTokens(user);

    user.currentSessionToken = accessToken;
    user.lastLogin = new Date();
    await user.save();

    res.json({
      success: true,
      isNewUser,
      accessToken,
      refreshToken,
      user: sanitizeUser(user),
    });
  } catch (error) {
    console.error('Google auth error:', error.message);
    res.status(401).json({ success: false, message: 'Google authentication failed' });
  }
};

// ============================================
// AUTH: REFRESH TOKEN
// ============================================

// ============================================
// AUTH: REFRESH TOKEN
// ============================================

exports.refreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    console.log('🔍 [REFRESH] Token received:', refreshToken ? 'YES' : 'NO');

    if (!refreshToken) {
      console.log('🔍 [REFRESH] No token in request body');
      return next(new AppError('Refresh token required', 400));
    }

    // Verify JWT
    console.log('🔍 [REFRESH] Verifying JWT...');
    const decoded = verifyRefreshToken(refreshToken);
    console.log('🔍 [REFRESH] JWT valid, user:', decoded.id);

    // Find and revoke old token
       // Find and revoke old token
    console.log('🔍 [REFRESH] Client token length:', refreshToken.length);
    console.log('🔍 [REFRESH] Client token:', refreshToken.substring(0, 50) + '...');

    // Check ALL unrevoked tokens for this user
    const allTokens = await RefreshToken.find({ user: decoded.id, isRevoked: false });
    console.log('🔍 [REFRESH] Total tokens in DB for user:', allTokens.length);
    
    let storedToken = null;
    for (const t of allTokens) {
      console.log('🔍 [REFRESH] DB token:', t.token.substring(0, 50) + '...');
      console.log('🔍 [REFRESH] DB token length:', t.token.length);
      console.log('🔍 [REFRESH] Exact match:', t.token === refreshToken);
      if (t.token === refreshToken) {
        storedToken = t;
        break;
      }
    }

    if (!storedToken) {
      console.log('🔍 [REFRESH] No matching token found');
      return next(new AppError('Invalid refresh token', 401));
    }
    console.log('🔍 [REFRESH] Decoded ID type:', typeof decoded.id);
console.log('🔍 [REFRESH] Decoded ID:', decoded.id);

    console.log('🔍 [REFRESH] ✅ Match found!');
    // Revoke old token
    storedToken.isRevoked = true;
    await storedToken.save();
    console.log('🔍 [REFRESH] Old token revoked');

    // Generate new tokens
    const newAccessToken = generateAccessToken(decoded.id, decoded.role);
    const newRefreshToken = generateRefreshToken(decoded.id);
    console.log('🔍 [REFRESH] New tokens generated');

    // Save new refresh token
    await RefreshToken.create({
      token: newRefreshToken,
      user: decoded.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    console.log('🔍 [REFRESH] New token saved to DB');

    // Update user session
    await User.findByIdAndUpdate(decoded.id, {
      currentSessionToken: newAccessToken,
      lastActive: new Date(),
    });
    console.log('🔍 [REFRESH] User session updated');

    res.status(200).json({
      success: true,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });
    console.log('🔍 [REFRESH] ✅ Success');
  } catch (error) {
    console.error('🔍 [REFRESH] ❌ Error:', error.name, '-', error.message);

    if (error.name === 'JsonWebTokenError') {
      return next(new AppError('Invalid refresh token', 401));
    }
    if (error.name === 'TokenExpiredError') {
      return next(new AppError('Refresh token expired. Please login again.', 401));
    }
    next(error);
  }
};
// ============================================
// PASSWORD: FORGOT
// ============================================

exports.forgotPassword = async (req, res, next) => {
  try {
    const { phone } = req.body;
    const user = await User.findOne({ phone }).select('+password +loginAttempts +lockUntil');
    if (!user) {
      return res.status(200).json({ success: true, message: 'If registered, OTP sent' });
    }

    await otpService.sendOTP(phone, 'reset_password');

    res.status(200).json({ success: true, message: 'OTP sent' });
  } catch (error) {
    next(error);
  }
};

// ============================================
// PASSWORD: RESET
// ============================================

exports.resetPassword = async (req, res, next) => {
  try {
    const { phone, code, newPassword } = req.body;

    // Find verified OTP
    const otpRecord = await Otp.findOne({ phone, code, verified: true });
    if (!otpRecord) {
      return next(new AppError('OTP not verified. Please verify first.', 400));
    }

    if (otpRecord.expiresAt < new Date()) {
      return next(new AppError('Verification expired. Please request a new code.', 400));
    }

    // Update password
    const user = await User.findOne({ phone }).select('+password +loginAttempts +lockUntil');
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    user.password = newPassword;
    user.currentSessionToken = null; // Force re-login
    await user.save();

    // Revoke all refresh tokens
    await RefreshToken.updateMany({ user: user._id, isRevoked: false }, { isRevoked: true });

    // Clean up OTP
    await Otp.deleteMany({ phone });

    res.status(200).json({ success: true, message: 'Password reset. Please login again.' });
  } catch (error) {
    next(error);
  }
};

// ============================================
// ACCOUNT: LOCK
// ============================================

exports.lockAccount = async (req, res, next) => {
  try {
    const { phone } = req.body;
    const user = await User.findOne({ phone }).select('+password +loginAttempts +lockUntil');
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    user.loginAttempts = 5;
    user.lockUntil = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Account locked for 30 minutes.',
      lockUntil: user.lockUntil,
    });
  } catch (error) {
    next(error);
  }
};

// ============================================
// AUTH: LOGOUT
// ============================================

exports.logout = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      await RefreshToken.findOneAndUpdate({ token: refreshToken }, { isRevoked: true });
    }

    await User.findByIdAndUpdate(req.user.id, {
      currentSessionToken: null,
      currentSocketId: null,
    });

    res.status(200).json({ success: true, message: 'Logged out' });
  } catch (error) {
    next(error);
  }
};

// ============================================
// USER: GET ME
// ============================================

exports.getMe = async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.user.id, { lastActive: new Date() });

    const user = await User.findById(req.user.id).select('-password -__v -currentSessionToken');

    res.status(200).json({
      success: true,
      user: {
        _id: user._id,
        phone: user.phone,
        fullName: user.fullName,
        username: user.username,
        email: user.email,
        role: user.role,
        balance: user.walletBalance || user.balance || 0,
        isActive: user.isActive,
        lastLogin: user.lastLogin,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
};