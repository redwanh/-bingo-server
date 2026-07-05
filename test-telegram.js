require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

const API_ID = parseInt(process.env.TELEGRAM_API_ID);
const API_HASH = process.env.TELEGRAM_API_HASH;
const SESSION = process.env.TELEGRAM_SESSION;

async function main() {
  console.log('📱 Connecting to Telegram...');
  
  const stringSession = new StringSession(SESSION);
  const client = new TelegramClient(stringSession, API_ID, API_HASH, {
    connectionRetries: 5,
  });

  await client.connect();
  console.log('✅ Connected!');
  
  // Send to test number
  const recipient = '+251911268622';
  
  console.log('📤 Sending test message to', recipient);
  
  await client.sendMessage(recipient, {
    message: '🎱 *Bingo OTP Test*\n\nYour code is: *1234*\n\nThis is a test message.',
  });
  
  console.log('✅ Message sent! Check that phone\'s Telegram app.');
  
  await client.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});