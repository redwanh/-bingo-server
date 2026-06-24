require('dotenv').config();
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const MainBingoGame = require('./src/models/MainBingoGame');
  const MainBingoConfig = require('./src/models/MainBingoConfig');
  const Card = require('./src/models/Card');
  
  await MainBingoGame.updateMany({ status: { $ne: 'completed' } }, { $set: { status: 'completed', endTime: new Date() } });
  await MainBingoConfig.updateMany({ status: { $ne: 'completed' } }, { $set: { status: 'completed' } });
  await Card.deleteMany({});
  
  console.log('✅ Main Bingo reset!');
  await mongoose.connection.close();
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
