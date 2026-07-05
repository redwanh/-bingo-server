const User = require('../models/User');
const Otp = require('../models/Otp');
const RefreshToken = require('../models/RefreshToken');
const otpService = require('../services/otpService');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const AppError = require('../utils/AppError');


// Send OTP for registration (checks number is NEW)
exports.sendRegistrationOTP = async (req, res, next) => {
  try {
    const { phone } = req.body;
    
    const existingUser = await User.findOne({ phone });
    if (existingUser) {
      return next(new AppError('PHONE_EXISTS', 400));
    }
    
   const { channel } = req.body;
console.log('🔍 [AUTH] Channel from request:', channel);
const result = await otpService.sendOTP(phone, 'registration', channel || 'test');
    res.status(200).json({ 
      success: true, 
      ...result,
      // Include code in dev mode so it can be displayed on the UI
      code: process.env.NODE_ENV !== 'production' ? result.code : undefined
    });
  } catch (error) {
    if (error.statusCode) return next(error);
    next(new AppError(error.message, error.statusCode || 500));
  }
};

// Send OTP for login/forgot password (checks number EXISTS)
exports.sendLoginOTP = async (req, res, next) => {
  try {
    const { phone } = req.body;
    
    const user = await User.findOne({ phone }).select('+password +loginAttempts +lockUntil');
    if (!user) {
      return next(new AppError('PHONE_NOT_FOUND', 400));
    }
    
    // Check if account is locked
    if (user.lockUntil && user.lockUntil > new Date()) {
      const waitMs = user.lockUntil.getTime() - Date.now();
      const waitMinutes = Math.ceil(waitMs / 60000);
      const waitSeconds = Math.ceil(waitMs / 1000);
      
      return res.status(423).json({
        success: false,
        errorCode: 'ACCOUNT_LOCKED',
        message: 'Account locked. Please wait ' + waitMinutes + ' minutes and ' + (waitSeconds % 60) + ' seconds.',
        retryAfterSeconds: waitSeconds,
        lockUntil: user.lockUntil
      });
    }
    
    // If lock expired, auto-unlock
    if (user.lockUntil && user.lockUntil <= new Date()) {
      user.loginAttempts = 0;
      user.lockUntil = undefined;
      await user.save();
    }
    
   const { channel } = req.body;
console.log('🔍 [AUTH] sendLoginOTP - channel:', channel);
const result = await otpService.sendOTP(phone, 'reset_password', channel || 'test');
    res.status(200).json({ 
      success: true, 
      ...result,
      code: process.env.NODE_ENV !== 'production' ? result.code : undefined
    });
  } catch (error) {
    if (error.statusCode) return next(error);
    next(new AppError(error.message, error.statusCode || 500));
  }
};


const { OAuth2Client } = require('google-auth-library');
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

exports.googleAuth = async (req, res) => {
  try {
    const { code, phone, fullName, password } = req.body;
    
    if (!code) {
      return res.status(400).json({ success: false, message: 'No code provided' });
    }
    
    const googleClient = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      'http://localhost:3001'
    );
    
    const { tokens } = await googleClient.getToken(code);
    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    
    const payload = ticket.getPayload();
    const email = payload.email;
    const name = payload.name;
    const googleId = payload.sub;
    
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
    
    const accessToken = generateAccessToken(user._id, user.role);
    const refreshToken = generateRefreshToken(user._id);
    
    user.currentSessionToken = accessToken;
    user.lastLogin = new Date();
    await user.save();
    
    res.json({
      success: true,
      isNewUser,
      accessToken,
      refreshToken,
      user: {
        _id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        balance: user.walletBalance || user.balance || 0,
      }
    });
  } catch (error) {
    console.error('Google auth error:', error.message);
    res.status(401).json({ success: false, message: 'Google authentication failed' });
  }
};
// Generic send OTP
exports.sendOTP = async (req, res, next) => {
  try {
    const { phone } = req.body;
    const user = await User.findOne({ phone }).select('+password +loginAttempts +lockUntil');
    if (!user) return res.status(200).json({ success: true, message: 'If registered, OTP sent' });
    
    const result = await otpService.sendOTP(phone, 'authentication');
    res.status(200).json({ 
      success: true, 
      ...result,
      code: process.env.NODE_ENV !== 'production' ? result.code : undefined
    });
  } catch (error) {
    if (error.statusCode) return next(error);
    next(new AppError(error.message, error.statusCode || 500));
  }
};

// Verify OTP
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

// Get OTP status (for countdown display)
exports.getOTPStatus = async (req, res, next) => {
  try {
    const { phone } = req.params;
    const status = await otpService.getOTPStatus(phone);
    res.status(200).json({ success: true, ...status });
  } catch (error) { next(error); }
};

exports.register = async (req, res, next) => {
  try {
    const { phone, password, fullName, username, otpCode } = req.body;
    
    const existingUser = await User.findOne({ phone });
    if (existingUser) return next(new AppError('User already exists', 400));
    
    // Verify OTP if provided
    if (otpCode) {
      const otpResult = await otpService.verifyOTP(phone, otpCode);
      if (!otpResult.success) return next(new AppError('Invalid or expired OTP', 400));
    }
    
    if (username) {
      const existingUsername = await User.findOne({ username });
      if (existingUsername) return next(new AppError('Username taken', 400));
    }
    
    const user = await User.create({
      phone, password,
      fullName: fullName || 'User_' + phone.slice(-4),
      username: username || 'user_' + phone.slice(-4) + '_' + Date.now().toString(36),
      isVerified: true
    });

    const accessToken = generateAccessToken(user._id, user.role);
    const refreshToken = generateRefreshToken(user._id);
    await RefreshToken.create({ token: refreshToken, user: user._id, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) });
    user.currentSessionToken = accessToken;
    user.lastLogin = new Date();
    user.lastActive = new Date();
    await user.save();
    

    // Log the created user for dev
    console.log('? New user registered:');
    console.log('   Phone:', user.phone);
    console.log('   Name:', user.fullName);
    console.log('   Role:', user.role);
    console.log('   ID:', user._id);

    res.status(201).json({ success: true, message: 'Registration successful', accessToken, refreshToken, user });
  } catch (error) { next(error); }
};

exports.login = async (req, res) => {
  console.log('?? LOGIN ATTEMPT:', { phone: req.body.phone, passwordProvided: !!req.body.password });
  try {
    const { phone, password } = req.body;
    
    // Find user
    const user = await User.findOne({ phone }).select('+password +loginAttempts +lockUntil');
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }
    
    // Check password
        console.log('?? User found:', { id: user._id, phone: user.phone, hasPassword: !!user.password, isActive: user.isActive });
    const isMatch = await user.comparePassword(password);
    console.log('?? Password match:', isMatch);
    if (!isMatch) {
      // Increment login attempts
      user.loginAttempts = (user.loginAttempts || 0) + 1;
      if (user.loginAttempts >= 5) {
        user.isActive = false;
        await user.save();
        return res.status(401).json({ 
          success: false, 
          message: 'Account locked due to too many failed attempts' 
        });
      }
      await user.save();
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }
    
    // Reset login attempts on success
    user.loginAttempts = 0;
    
    // Check if account is active
    if (!user.isActive) {
      return res.status(401).json({ 
        success: false, 
        message: 'Account deactivated' 
      });
    }
    
    // Generate tokens
    const accessToken = generateAccessToken(user._id, user.role);
    const refreshToken = generateRefreshToken(user._id);
    
    // ? IMPROVED: Update session token
    // Option 1: Always update (single device session)
    user.currentSessionToken = accessToken;
    
    // Option 2: Keep existing session (multiple devices)
    // if (!user.currentSessionToken) {
    //   user.currentSessionToken = accessToken;
    // }
    
    user.lastLogin = new Date();
    await user.save();
    
    // Remove sensitive data
    const userData = user.toObject();
    delete userData.password;
    delete userData.currentSessionToken;
    delete userData.__v;
    
    res.json({
      success: true,
      message: 'Login successful',
      accessToken,
      refreshToken,
      user: userData
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
};

// Add refresh token endpoint

exports.refreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return next(new AppError('Refresh token required', 400));
    const decoded = verifyRefreshToken(refreshToken);
    const storedToken = await RefreshToken.findOne({ token: refreshToken, isRevoked: false });
    if (!storedToken) return next(new AppError('Invalid refresh token', 401));
    storedToken.isRevoked = true; await storedToken.save();
    const newAccessToken = generateAccessToken(decoded.id, decoded.role);
    const newRefreshToken = generateRefreshToken(decoded.id);
    await RefreshToken.create({ token: newRefreshToken, user: decoded.id, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) });
    await User.findByIdAndUpdate(decoded.id, { currentSessionToken: newAccessToken, lastActive: new Date() });
    res.status(200).json({ success: true, accessToken: newAccessToken, refreshToken: newRefreshToken });
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') return next(new AppError('Invalid or expired refresh token', 401));
    next(error);
  }
};

exports.forgotPassword = async (req, res, next) => {
  try {
    const { phone } = req.body;
    const user = await User.findOne({ phone }).select('+password +loginAttempts +lockUntil');
    if (!user) return res.status(200).json({ success: true, message: 'If registered, OTP sent' });
    await otpService.sendOTP(phone, 'reset_password');
    res.status(200).json({ success: true, message: 'OTP sent' });
  } catch (error) { next(error); }
};

exports.resetPassword = async (req, res, next) => {
  try {
    const { phone, code, newPassword } = req.body;
    
    // Find the already-verified OTP (don't re-verify, just check it exists)
    const otpRecord = await Otp.findOne({ 
      phone, 
      code,
      verified: true,  // Must have been verified already
    });
    
    if (!otpRecord) {
      return next(new AppError('OTP not verified. Please verify first.', 400));
    }
    
    // Check OTP hasn't expired since verification
    if (otpRecord.expiresAt < new Date()) {
      return next(new AppError('Verification expired. Please request a new code.', 400));
    }
    
    const user = await User.findOne({ phone }).select('+password +loginAttempts +lockUntil');
    if (!user) return next(new AppError('User not found', 404));
    
    user.password = newPassword;
    user.currentSessionToken = null;
    await user.save();
    await RefreshToken.updateMany({ user: user._id, isRevoked: false }, { isRevoked: true });
    
    // Clean up OTP
    await Otp.deleteMany({ phone });
    
    res.status(200).json({ success: true, message: 'Password reset. Please login again.' });
  } catch (error) { next(error); }
};


// Lock account after too many OTP failures (called from forgot password flow)
exports.lockAccount = async (req, res, next) => {
  try {
    const { phone } = req.body;
    const user = await User.findOne({ phone }).select('+password +loginAttempts +lockUntil');
    if (!user) return next(new AppError('User not found', 404));
    
    user.loginAttempts = 5; // Force lock
    user.lockUntil = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
    await user.save();
    
    res.status(200).json({
      success: true,
      message: 'Account locked for 30 minutes due to too many OTP attempts.',
      lockUntil: user.lockUntil
    });
  } catch (error) { next(error); }
};

exports.logout = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) await RefreshToken.findOneAndUpdate({ token: refreshToken }, { isRevoked: true });
    await User.findByIdAndUpdate(req.user.id, { currentSessionToken: null, currentSocketId: null });
    res.status(200).json({ success: true, message: 'Logged out' });
  } catch (error) { next(error); }
};
exports.getMe = async (req, res, next) => {
  try {
    // Fix: Use a valid Date object, don't pass the whole req.user back
    await User.findByIdAndUpdate(req.user.id, { 
      lastActive: new Date() 
    });
    
    // Return user without sensitive data
    const user = await User.findById(req.user.id)
      .select('-password -__v -currentSessionToken -refreshTokens');
    
    res.status(200).json({ 
      success: true, 
      user: {
        _id: user._id,
        phoneNumber: user.phoneNumber,
        fullName: user.fullName,
        username: user.username,
        role: user.role,
        balance: user.balance || user.walletBalance,
        isActive: user.isActive,
        lastLogin: user.lastLogin,
        createdAt: user.createdAt
      }
    });
  } catch (error) { 
    next(error); 
  }
};



