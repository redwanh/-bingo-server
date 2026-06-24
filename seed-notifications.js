require('dotenv').config();
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const Notification = require('./src/models/Notification');
  const User = require('./src/models/User');
  
  const users = await User.find({ isActive: true }).limit(5);
  
  const messages = [
    '🎉 You won 500 ETB in Fast Bingo!',
    '🔔 New game starting in 30 seconds',
    '💰 Prize pool reached 2,500 ETB',
    '👤 Admin updated game settings',
    '🎯 Main Bingo: New game created'
  ];
  
  for (const user of users) {
    for (const msg of messages) {
      await Notification.create({
        userId: user._id,
        message: msg,
        type: 'system',
        read: Math.random() > 0.5
      });
    }
  }
  
  console.log('✅ Sample notifications created for', users.length, 'users');
  await mongoose.connection.close();
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
