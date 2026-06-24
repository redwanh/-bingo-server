// reset-otp.js
// Run this to clear all OTP rate limits during development
const mongoose = require('mongoose');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/bingo';

async function resetOTP() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');
    
    const Otp = require('./src/models/Otp');
    const result = await Otp.deleteMany({});
    console.log('✅ Deleted ' + result.deletedCount + ' OTP records');
    console.log('✅ Rate limits cleared!');
    
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

resetOTP();
