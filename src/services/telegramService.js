const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

const API_ID = parseInt(process.env.TELEGRAM_API_ID);
const API_HASH = process.env.TELEGRAM_API_HASH;
const SESSION = process.env.TELEGRAM_SESSION || '';

let client = null;

async function getClient() {
  if (client && client.connected) return client;
  
  const stringSession = new StringSession(SESSION);
  client = new TelegramClient(stringSession, API_ID, API_HASH, {
    connectionRetries: 5,
  });
  
  await client.connect();
  console.log('✅ Telegram connected');
  return client;
}

async function sendOTP(phoneNumber, otpCode) {
  try {
    const c = await getClient();
    
    const recipient = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;
    
    await c.sendMessage(recipient, {
      message: `🎱 *Bingo OTP Code*\n\nYour verification code is: *${otpCode}*\n\nThis code expires in 5 minutes.`,
    });
    
    console.log(`✈️ OTP sent to ${recipient} via Telegram`);
    return true;
  } catch (error) {
    console.error('❌ Telegram send error:', error.message);
    throw new Error('Failed to send OTP via Telegram');
  }
}

async function disconnect() {
  if (client) {
    await client.disconnect();
    client = null;
  }
}

module.exports = { sendOTP, disconnect };