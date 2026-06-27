// server/models/MainBingoConfig.js
const mongoose = require('mongoose');

const mainBingoConfigSchema = new mongoose.Schema({
  ruleId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'MainBingoRule', 
    required: true 
  },
  ruleName: String,
  cardPrice: { 
    type: Number, 
    required: true, 
    min: 1 
  },
  maxCardsPerPlayer: { 
    type: Number, 
    default: 10 
  },
  prizeAmount: { 
    type: Number, 
    default: 0 
  },
  
  // 🔥 NEW FIELDS
  callIntervalSeconds: {
    type: Number,
    default: 5,  // Default 5 seconds between number calls
    min: 1,
    max: 60
  },
  
  isLastNumberCalledBingo: {
    type: Boolean,
    default: false  // If true, automatically declare BINGO on last number
  },
  
  gracePeriodSeconds: {
    type: Number,
    default: 10,  // Seconds to wait for BINGO claim after last number
    min: 0,
    max: 120
  },
  
  gameStartingSeconds: {
    type: Number,
    default: 30,  // Countdown before game starts
    min: 5,
    max: 120
  },
  
  noOfPlayersToStart: {
    type: Number,
    default: 2,  // Minimum players required to start
    min: 1
  },
  
  minimumCardsToStart: {
    type: Number,
    default: 1,  // Minimum total cards sold to start
    min: 1
  },
  
  status: { 
    type: String, 
    enum: ['setup', 'countdown', 'in_progress', 'completed'], 
    default: 'setup' 
  },
  createdBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  }
}, { timestamps: true });

module.exports = mongoose.model('MainBingoConfig', mainBingoConfigSchema);