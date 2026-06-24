const mongoose = require('mongoose');
const CMS = require('../models/CMS');

const seedData = [
  // ============ ENGLISH ============
  { type: 'terms', language: 'en', title: 'Terms of Service', content: 'Welcome to Lucky Night Bingo. By using our platform, you agree to these terms. Players must be 18 years or older. All game results are final. We reserve the right to suspend accounts for fraudulent activity.', order: 1 },
  { type: 'terms', language: 'en', title: 'Privacy Policy', content: 'We collect minimal personal data required for account operation. Your data is encrypted and never shared with third parties.', order: 2 },
  { type: 'faq', language: 'en', question: 'How do I play Bingo?', answer: 'Select your cards before the game starts. Numbers will be drawn automatically. Mark numbers on your card or enable auto-mark. Call BINGO when you complete a winning pattern!', order: 1 },
  { type: 'faq', language: 'en', question: 'How do I deposit money?', answer: 'Go to the Deposit section in the app. Choose your payment method (Telebirr or CBE). Enter the amount and follow the instructions.', order: 2 },
  { type: 'contact', language: 'en', contactType: 'phone', label: 'Customer Support', value: '+251912345678', order: 1 },
  { type: 'contact', language: 'en', contactType: 'email', label: 'Email', value: 'support@luckynightbingo.com', order: 2 },

  // ============ AMHARIC ============
  { type: 'terms', language: 'am', title: 'የአገልግሎት ውል', content: 'እንኳን ወደ ላኪ ናይት ቢንጎ በደህና መጡ። ተጫዋቾች ከ18 አመት በላይ መሆን አለባቸው።', order: 1 },
  { type: 'faq', language: 'am', question: 'ቢንጎ እንዴት እጫወታለሁ?', answer: 'ካርዶችዎን ይምረጡ። ቁጥሮች በራስ-ሰር ይቀዳሉ። BINGO ይደውሉ!', order: 1 },
  { type: 'contact', language: 'am', contactType: 'phone', label: 'የደንበኛ ድጋፍ', value: '+251912345678', order: 1 },

  // ============ TIGRIGNA ============
  { type: 'terms', language: 'tg', title: 'ናይ ኣገልግሎት ውል', content: 'ናብ ላኪ ናይት ቢንጎ እንቋዕ ብደሓን መጻእኩም። ተጻዋታይ ካብ 18 ዓመት ንላዕሊ ክኾኑ ኣለዎም።', order: 1 },
  { type: 'faq', language: 'tg', question: 'ቢንጎ ከመይ ገይረ እጻወቶ?', answer: 'ካርድታትኩም ምረጹ። ቁጽርታት ብኣውቶማቲክ ክስኣሉ እዮም። BINGO ጸውዑ!', order: 1 },
  { type: 'contact', language: 'tg', contactType: 'phone', label: 'ደገፍ ዓሚላት', value: '+251912345678', order: 1 },
];

async function seedCMS() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/bingo-platform');
    await CMS.deleteMany({});
    await CMS.insertMany(seedData);
    console.log('CMS seeded successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Seed error:', err);
    process.exit(1);
  }
}

seedCMS();