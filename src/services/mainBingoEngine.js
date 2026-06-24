const MainBingoGame = require('../models/MainBingoGame');
const MainBingoConfig = require('../models/MainBingoConfig');
const MainBingoRule = require('../models/MainBingoRule');
const Card = require('../models/Card');
const User = require('../models/User');
const Transaction = require('../models/Transaction');

class MainBingoEngine {
  constructor(io) {
    this.io = io;
    this.drawTimers = new Map();
    this.graceTimers = new Map();
  }

  getBingoLetter(num) {
    if (num <= 15) return 'B'; if (num <= 30) return 'I';
    if (num <= 45) return 'N'; if (num <= 60) return 'G'; return 'O';
  }

  async startGamePlay(gameId) {
    const game = await MainBingoGame.findById(gameId);
    if (!game || game.status !== 'countdown') return;
    game.status = 'in_progress'; game.startTime = new Date(); await game.save();
    await MainBingoConfig.findByIdAndUpdate(game.configId, { status: 'in_progress' });
    this.io.emit('mainBingoStarted', { game });
    this.drawNumbers(game);
  }

  drawNumbers(game) {
    let idx = 0;
    const interval = setInterval(async () => {
      try {
        const current = await MainBingoGame.findById(game._id);
        if (!current || current.status === 'completed' || current.status === 'grace_period') {
          clearInterval(interval); return;
        }
        if (idx >= current.allNumbers.length) { clearInterval(interval); return; }
        const num = current.allNumbers[idx];
        const letter = this.getBingoLetter(num);
        current.currentNumber = { number: num, letter };
        current.drawnNumbers.push({ number: num, letter });
        await current.save();
        this.io.emit('mainBingoNumberDrawn', { number: num, letter, drawCount: idx + 1 });
        idx++;
      } catch (e) { console.error('Draw error:', e); }
    }, 5000);
    this.drawTimers.set(game._id.toString(), interval);
  }

checkWin(rule, card, drawnNumbers) {
    const drawnSet = new Set(drawnNumbers.map(d => d.number));
    const COLS = ['B','I','N','G','O'];
    
    if (rule.method === 'pattern') {
      for (const pattern of rule.patterns) {
        if (pattern.cells.every(c => {
          const cell = card.grid[COLS[c[1]]][c[0]];
          const cellNumber = cell.number;
          // 🔥 Check if NUMBER IS DRAWN, not if cell is marked
          if (c[1] === 2 && c[0] === 2 && rule.ruleConfig?.freeSpaceCounts) return true;
          return drawnSet.has(cellNumber);
        })) return 'pattern';
      }
      return null;
    }
    
    const cfg = rule.ruleConfig || {};
    let rows = 0, cols = 0, diags = 0;
    
    for (let r = 0; r < 5; r++) {
      let ok = true;
      for (let c = 0; c < 5; c++) {
        if (c === 2 && r === 2 && cfg.freeSpaceCounts) continue;
        const cellNumber = card.grid[COLS[c]][r].number;
        if (!drawnSet.has(cellNumber)) { ok = false; break; }
      }
      if (ok) rows++;
    }
    
    for (let c = 0; c < 5; c++) {
      let ok = true;
      for (let r = 0; r < 5; r++) {
        if (c === 2 && r === 2 && cfg.freeSpaceCounts) continue;
        const cellNumber = card.grid[COLS[c]][r].number;
        if (!drawnSet.has(cellNumber)) { ok = false; break; }
      }
      if (ok) cols++;
    }
    
    let d1 = true, d2 = true;
    for (let i = 0; i < 5; i++) {
      if (!(i === 2 && cfg.freeSpaceCounts) && !drawnSet.has(card.grid[COLS[i]][i].number)) d1 = false;
      if (!(i === 2 && cfg.freeSpaceCounts) && !drawnSet.has(card.grid[COLS[4-i]][i].number)) d2 = false;
    }
    if (d1) diags++; if (d2) diags++;
    
    const total = rows + cols + diags;
    if (total >= (cfg.linesToWin || 1) && rows >= (cfg.minRows || 0) && cols >= (cfg.minColumns || 0) && diags >= (cfg.minDiagonals || 0)) return 'rule_win';
    return null;
}

async callBingo(userId, cardId) {
  console.log('🎯 BINGO VALIDATION STARTED');
  console.log('   UserId:', userId);
  console.log('   CardId:', cardId);

  // Step 1: Find the active game
  const game = await MainBingoGame.getActiveGame();
  if (!game) {
    console.log('❌ No active game');
    return { success: false, reason: 'No active game' };
  }
  if (game.status !== 'in_progress' && game.status !== 'bingo_called') {
    console.log('❌ Game not in progress. Status:', game.status);
    return { success: false, reason: 'Game not in progress' };
  }

  // Step 2: Find the card
  const card = await Card.findOne({ _id: cardId, userId, gameId: game._id });
  if (!card) {
    console.log('❌ Card not found or not owned by user');
    return { success: false, reason: 'Card not found' };
  }
  if (card.isBlocked) {
    console.log('❌ Card is blocked');
    return { success: false, reason: 'Card is blocked' };
  }
  if (card.bingoCalled) {
    console.log('❌ BINGO already called on this card');
    return { success: false, reason: 'BINGO already called' };
  }

  // Step 3: Get the drawn numbers
  const drawnNumbers = game.drawnNumbers || [];
  const drawnSet = new Set(drawnNumbers.map(d => d.number));
  console.log('📊 Drawn numbers count:', drawnSet.size);

  // Step 4: Check ALL marked numbers exist in drawn numbers


  // Step 5: Get the game rule
  const rule = await MainBingoRule.findById(game.ruleId);
  if (!rule) {
    console.log('❌ Rule not found');
    return { success: false, reason: 'Rule not found' };
  }
  console.log('📋 Rule:', rule.name, '| Method:', rule.method);

  // Step 6: Check winning pattern
  const winType = this.checkWin(rule, card, drawnNumbers);
  
  if (!winType) {
    console.log('❌ No winning pattern found');
    card.isBlocked = true;
    card.blockReason = 'no_win';
    await card.save();
    this.io.emit('mainBingoFalseBingo', { 
      userId, 
      cardId, 
      reason: 'no_win' 
    });
    return { success: false, reason: 'no_win' };
  }

  // Step 7: VALID BINGO!
  console.log('✅ VALID BINGO! Win type:', winType);
  card.bingoCalled = true;
  card.bingoCallTime = new Date();
  card.winType = winType;
  await card.save();

  // Step 8: Handle first bingo vs additional bingo
  if (game.status === 'in_progress') {
    // 🔥 Stop drawing numbers
    if (this.drawTimers.has(game._id.toString())) {
      clearInterval(this.drawTimers.get(game._id.toString()));
      this.drawTimers.delete(game._id.toString());
    }
    game.status = 'bingo_called';
    game.gracePeriodEndTime = new Date(Date.now() + 15000);
    await game.save();
    
    this.io.emit('mainBingoFirstBingo', { 
      userId, 
      cardId, 
      winType,
      cardNumber: card.cardNumber 
    });
    // Emit grace period start with countdown
this.io.emit('mainBingoGracePeriod', { 
  seconds: 15, 
  endTime: game.gracePeriodEndTime,
  firstWinner: { userId, cardId, winType }
});
    
    // Start 20-second grace period
    const graceTimer = setTimeout(() => this.endGracePeriod(game._id), 15000);
    this.graceTimers.set(game._id.toString(), graceTimer);
    
  } else {
    // Additional BINGO during grace period
    await game.save();
    this.io.emit('mainBingoAdditionalBingo', { 
      userId, 
      cardId, 
      winType,
      cardNumber: card.cardNumber 
    });
  }

  console.log('✅ BINGO VALIDATION COMPLETE');
  return { success: true, winType };
}

async endGracePeriod(gameId) {
  const game = await MainBingoGame.findById(gameId);
  if (!game || game.status === 'completed') return;
  
  const calledCards = await Card.find({ gameId: game._id, bingoCalled: true, isBlocked: false })
    .populate('userId', 'fullName phone');
  
  const winners = [];
  for (const card of calledCards) {
    const rule = await MainBingoRule.findById(game.ruleId);
    if (this.checkWin(rule, card, game.drawnNumbers)) {
      card.bingoValidated = true;
      await card.save();
      winners.push({
        userId: card.userId._id,
        cardId: card._id,
        winnerName: card.userId.fullName,
        winnerPhone: card.userId.phone,
        cardGrid: card.grid,
        cardNumber: card.cardNumber,
        winType: card.winType,
      });
    }
  }
  
  if (winners.length > 0) {
    const prize = game.prizeAmount / winners.length;
    for (const winner of winners) {
      await User.findByIdAndUpdate(winner.userId, { $inc: { walletBalance: prize } });
      winner.prizeAmount = prize;
      game.winners.push(winner);
    }
  }
  
  game.status = 'completed';
  game.endTime = new Date();
  await game.save();
  
  if (this.drawTimers.has(game._id.toString())) {
    clearInterval(this.drawTimers.get(game._id.toString()));
    this.drawTimers.delete(game._id.toString());
  }
  
  // Emit winners
  this.io.emit('mainBingoEnded', { 
    game, 
    winners,
    showDuration: 10000  // Show for 10 seconds
  });
}
}

// Watcher function
MainBingoEngine.startDrawingIfNeeded = async function(io) {
  try {
    const game = await MainBingoGame.getActiveGame();
    if (game && game.status === 'in_progress' && (!game.drawnNumbers || game.drawnNumbers.length === 0)) {
      console.log('Auto-starting drawing for game:', game.gameId);
      const engine = new MainBingoEngine(io);
      engine.drawNumbers(game);
    }
  } catch (e) { /* ignore */ }
};

module.exports = MainBingoEngine;

