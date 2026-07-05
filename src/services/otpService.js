const Otp = require('../models/Otp');
const smsService = require('./smsService');
//const telegramService = require('./telegramService');

class OTPService {
  constructor() {
    this.EXPIRY_MINUTES = process.env.NODE_ENV === 'production' ? 5 : 10;
    this.MAX_ATTEMPTS = 5;
    this.RATE_LIMIT_SECONDS = process.env.NODE_ENV === 'production' ? 60 : 10;
    this.CODE_LENGTH = 4;
  }

generateCode(channel = 'test') {
    if (channel === 'test') {
      return '1234';
    }
    
    // Real random code for Telegram/SMS
    const code = String(Math.floor(1000 + Math.random() * 9000));
    console.log('🔍 [OTP] Generated random code:', code, 'for channel:', channel);
    return code;
}


  // Send OTP with channel support
  async sendOTP(phone, purpose = 'authentication', channel = 'test') {
    // 1. Rate limit check
    const recentOTP = await Otp.findOne({
      phone,
      createdAt: { $gt: new Date(Date.now() - this.RATE_LIMIT_SECONDS * 1000) }
    });

    if (recentOTP) {
      const waitSeconds = this.RATE_LIMIT_SECONDS - 
        Math.floor((Date.now() - recentOTP.createdAt.getTime()) / 1000);
      
      throw Object.assign(new Error('RATE_LIMITED'), {
        statusCode: 429,
        waitSeconds,
        message: 'Please wait ' + waitSeconds + ' seconds before requesting a new code'
      });
    }

    // 2. Too many attempts today?
    const todayAttempts = await Otp.countDocuments({
      phone,
      createdAt: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });
    
    if (todayAttempts >= (process.env.NODE_ENV === 'production' ? 10 : 100)) {
      throw Object.assign(new Error('DAILY_LIMIT'), {
        statusCode: 429,
        message: 'Too many OTP requests. Please try again tomorrow.'
      });
    }

    // 3. Generate code based on channel
    const code = this.generateCode(channel);
console.log('🔍 [OTP] sendOTP - channel:', channel, 'code:', code, 'phone:', phone);

    // 4. Delete old OTPs for this phone
    await Otp.deleteMany({ phone });

    // 5. Save to database
    const otpRecord = await Otp.create({
      phone,
      code,
      purpose,
      channel,
      expiresAt: new Date(Date.now() + this.EXPIRY_MINUTES * 60 * 1000),
      attempts: 0,
    });

    // 6. Send via selected channel
    let sendResult = { success: true, provider: channel };

    const message = 'Your Bingo verification code is: ' + code + 
      '. Expires in ' + this.EXPIRY_MINUTES + ' minutes.';

    try {
      if (channel === 'telegram') {
       // await telegramService.sendOTP(phone, code);
        console.log('⚠️ Telegram not configured, using test code');
        sendResult = { success: true, provider: 'telegram' };
      } else if (channel === 'sms') {
        sendResult = await smsService.send(phone, message);
      }
      // 'test' channel: no external send, just store in DB
    } catch (sendError) {
      console.error(`${channel} send failed:`, sendError.message);
      sendResult = { success: false, error: sendError.message, provider: channel };
    }

    return {
      success: true,
      message: 'OTP sent',
      expiresIn: this.EXPIRY_MINUTES * 60,
      code: (process.env.NODE_ENV !== 'production' || channel === 'test') ? code : undefined,
      channel: channel,
      provider: sendResult.provider || channel,
    };
  }

  // Verify OTP
  async verifyOTP(phone, code) {
    // 1. Find valid OTP
    const otpRecord = await Otp.findOne({
      phone,
      expiresAt: { $gt: new Date() },
      verified: false,
    }).sort({ createdAt: -1 });

    if (!otpRecord) {
      return { 
        success: false, 
        errorCode: 'OTP_EXPIRED',
        message: 'Code has expired. Please request a new one.' 
      };
    }

    // 2. Check attempts
    if (otpRecord.attempts >= this.MAX_ATTEMPTS) {
      const timeUntilExpiry = Math.floor((otpRecord.expiresAt.getTime() - Date.now()) / 1000);
      const minutes = Math.floor(timeUntilExpiry / 60);
      const seconds = timeUntilExpiry % 60;
      
      return { 
        success: false, 
        errorCode: 'MAX_ATTEMPTS',
        message: 'Too many attempts. Try again in ' + minutes + 'm ' + seconds + 's.',
        retryAfterSeconds: timeUntilExpiry
      };
    }

    // 3. Check code
    if (otpRecord.code !== code) {
      otpRecord.attempts += 1;
      await otpRecord.save();
      
      const remaining = this.MAX_ATTEMPTS - otpRecord.attempts;
      return { 
        success: false, 
        errorCode: 'INVALID_CODE',
        message: 'Invalid code. ' + remaining + ' attempts remaining.' 
      };
    }

    // 4. Success — mark as verified
    otpRecord.verified = true;
    await otpRecord.save();

    return { 
      success: true, 
      message: 'OTP verified successfully',
      purpose: otpRecord.purpose,
    };
  }

  // Get remaining time for OTP
  async getOTPStatus(phone) {
    const otpRecord = await Otp.findOne({
      phone,
      expiresAt: { $gt: new Date() },
      verified: false,
    }).sort({ createdAt: -1 });

    if (!otpRecord) {
      return { active: false };
    }

    const remainingSeconds = Math.floor((otpRecord.expiresAt.getTime() - Date.now()) / 1000);
    return {
      active: true,
      remainingSeconds,
      attemptsUsed: otpRecord.attempts,
      attemptsRemaining: this.MAX_ATTEMPTS - otpRecord.attempts,
      expiresAt: otpRecord.expiresAt,
    };
  }
}

module.exports = new OTPService();