// services/smsService.js
// Pluggable SMS providers — swap in production
class SMSService {
  constructor() {
    this.provider = process.env.SMS_PROVIDER || 'console'; // console | twilio | africa_talking | telegram
  }

  async send(phone, message) {
    switch (this.provider) {
      case 'twilio':
        return this.sendViaTwilio(phone, message);
      case 'africa_talking':
        return this.sendViaAfricaTalking(phone, message);
      case 'telegram':
        return this.sendViaTelegram(phone, message);
      case 'console':
      default:
        return this.sendViaConsole(phone, message);
    }
  }

  // Development: Log to console
  async sendViaConsole(phone, message) {
    const otp = message.match(/\d{4,6}/)?.[0] || '----';
    console.log('');
    console.log('╔══════════════════════════════════════╗');
    console.log('║         📱 SMS SENT (DEV)            ║');
    console.log('╠══════════════════════════════════════╣');
    console.log('║  Phone: ' + phone.padEnd(28) + '║');
    console.log('║  OTP:   ' + otp.padEnd(28) + '║');
    console.log('║  Msg:   ' + message.substring(0, 26).padEnd(28) + '║');
    console.log('╚══════════════════════════════════════╝');
    console.log('');
    return { success: true, provider: 'console', otp };
  }

  // Twilio implementation
  async sendViaTwilio(phone, message) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_PHONE_NUMBER;
    if (!accountSid || !authToken) throw new Error('Twilio not configured');

    const response = await fetch(
      'https://api.twilio.com/2010-04-01/Accounts/' + accountSid + '/Messages.json',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + Buffer.from(accountSid + ':' + authToken).toString('base64')
        },
        body: new URLSearchParams({ To: phone, From: from, Body: message })
      }
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Twilio send failed');
    return { success: true, provider: 'twilio', sid: data.sid };
  }

  // Africa's Talking implementation
  async sendViaAfricaTalking(phone, message) {
    const apiKey = process.env.AT_API_KEY;
    const username = process.env.AT_USERNAME;
    if (!apiKey || !username) throw new Error('Africa\'s Talking not configured');

    const response = await fetch('https://api.africastalking.com/version1/messaging', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'apiKey': apiKey,
        'Accept': 'application/json'
      },
      body: new URLSearchParams({ username, to: phone, message })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.SMSMessageData?.Message || 'AT send failed');
    return { success: true, provider: 'africa_talking' };
  }

  // Telegram fallback
  async sendViaTelegram(phone, message) {
    if (!process.env.TELEGRAM_BOT_TOKEN) return { success: false, reason: 'Telegram not configured' };
    try {
      const User = require('../models/User');
      const user = await User.findOne({ phone });
      if (user?.telegramChatId) {
        const response = await fetch(
          'https://api.telegram.org/bot' + process.env.TELEGRAM_BOT_TOKEN + '/sendMessage',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: user.telegramChatId, text: message })
          }
        );
        return { success: response.ok, provider: 'telegram' };
      }
    } catch (e) { console.error('Telegram error:', e.message); }
    return { success: false, provider: 'telegram', reason: 'No chat ID' };
  }
}

module.exports = new SMSService();
