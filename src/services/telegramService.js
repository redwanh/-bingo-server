let telegramService;

try {
  const { TelegramClient } = require('telegram');
  const { StringSession } = require('telegram/sessions');
  // ... rest of code
  telegramService = { sendOTP, connect, disconnect };
} catch (e) {
  console.log('⚠️ Telegram not available:', e.message);
  telegramService = { 
    sendOTP: async () => { throw new Error('Telegram not available'); },
    connect: async () => {},
    disconnect: async () => {},
  };
}

module.exports = telegramService;