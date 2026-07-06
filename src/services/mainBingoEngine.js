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

  getRoomId(game) {
    return 'main-bingo-room'; // Always use main bingo room
}

  getBingoLetter(num) {
    if (num <= 15) return 'B'; 
    if (num <= 30) return 'I';
    if (num <= 45) return 'N'; 
    if (num <= 60) return 'G'; 
    return 'O';
  }

  async startGamePlay(gameId) {
    console.log('🚀 Engine: Starting game play for:', gameId);
    
    const game = await MainBingoGame.findById(gameId);
    if (!game || game.status !== 'countdown') {
      console.log('⚠️ Game not in countdown status, aborting');
      return;
    }
    
    const config = await MainBingoConfig.findById(game.configId);
    
    game.status = 'in_progress'; 
    game.startTime = new Date(); 
    await game.save();
    
    await MainBingoConfig.findByIdAndUpdate(game.configId, { status: 'in_progress' });
    
    const roomId = this.getRoomId(game);
    this.io.to(roomId).emit('mainBingoStarted', { game });
    
    this.drawNumbers(game);
  }

 async drawNumbers(game) {
    const config = await MainBingoConfig.findById(game.configId);
    const callIntervalMs = (config?.callIntervalSeconds || 5) * 1000;
    const gracePeriodSeconds = config?.gracePeriodSeconds || 10;
    const roomId = this.getRoomId(game);
    
    console.log(`🎱 Starting draws every ${callIntervalMs}ms for room: ${roomId}`);
    
    let idx = game.drawnNumbers?.length || 0;
    const allNumbers = game.allNumbers;
    
    const interval = setInterval(async () => {
      try {
        const current = await MainBingoGame.findById(game._id).select('status');
        
        if (!current || current.status !== 'in_progress') {
          console.log('🛑 Stopping draws');
          clearInterval(interval);
          this.drawTimers.delete(game._id.toString());
          return;
        }
        
        if (idx >= allNumbers.length) {
          console.log('🏁 All numbers drawn');
          clearInterval(interval);
          this.drawTimers.delete(game._id.toString());

          
          this.io.to(roomId).emit('mainBingoGracePeriod', {
            seconds: gracePeriodSeconds,
            endTime: new Date(Date.now() + gracePeriodSeconds * 1000)
          });
          
          const graceTimer = setTimeout(() => this.endGracePeriod(game._id), gracePeriodSeconds * 1000);
          this.graceTimers.set(game._id.toString(), graceTimer);
          return;
        }
        
     const num = allNumbers[idx];
const letter = this.getBingoLetter(num);

// Load fresh game, push number, save
const freshGame = await MainBingoGame.findById(game._id);
freshGame.drawnNumbers.push({ number: num, letter, drawnAt: new Date() });
freshGame.currentNumber = { number: num, letter };
await freshGame.save();

console.log(`🎱 Drew: ${letter}${num} | DB count: ${freshGame.drawnNumbers.length}`);
        // Emit to all players
        this.io.to(roomId).emit('mainBingoNumberDrawn', {
          number: num,
          letter,
          drawCount: idx + 1,
          totalNumbers: allNumbers.length
        });
        
        idx++;
        
      } catch (e) {
        console.error('❌ Draw error:', e);
      }
    }, callIntervalMs);
    
    this.drawTimers.set(game._id.toString(), interval);
  }
    checkWin(rule, card, drawnNumbers, config) {
    const drawnSet = new Set(drawnNumbers.map(d => d.number));
    const COLS = ['B','I','N','G','O'];
    
    console.log('🔍 [CHECKWIN] Drawn numbers:', [...drawnSet].sort((a,b)=>a-b).join(', '));
    
    const effectiveMarked = new Set();
    
    for (let c = 0; c < 5; c++) {
      for (let r = 0; r < 5; r++) {
        const cell = card.grid[COLS[c]]?.[r];
        if (!cell) continue;
        
        if (c === 2 && r === 2 && config?.freeSpaceCounts !== false) {
          effectiveMarked.add(`${c},${r}`);
          continue;
        }
        
        if (cell.isMarked && cell.number > 0 && drawnSet.has(cell.number)) {
          effectiveMarked.add(`${c},${r}`);
        }
      }
    }
    
    // Pattern check
    if (rule.method === 'pattern' && rule.patterns?.length > 0) {
      for (const pattern of rule.patterns) {
        if (pattern.cells.every(([row, col]) => effectiveMarked.has(`${col},${row}`))) {
          return 'pattern';
        }
      }
      return null;
    }
    
    // Line check
    const cfg = rule.ruleConfig || {};
    let rows = 0, cols = 0, diags = 0;
    
    for (let r = 0; r < 5; r++) {
      let ok = true;
      for (let c = 0; c < 5; c++) {
        if (c === 2 && r === 2 && cfg.freeSpaceCounts) continue;
        if (!effectiveMarked.has(`${c},${r}`)) { ok = false; break; }
      }
      if (ok) rows++;
    }
    
    for (let c = 0; c < 5; c++) {
      let ok = true;
      for (let r = 0; r < 5; r++) {
        if (c === 2 && r === 2 && cfg.freeSpaceCounts) continue;
        if (!effectiveMarked.has(`${c},${r}`)) { ok = false; break; }
      }
      if (ok) cols++;
    }
    
    let d1 = true, d2 = true;
    for (let i = 0; i < 5; i++) {
      if (!(i === 2 && cfg.freeSpaceCounts) && !effectiveMarked.has(`${i},${i}`)) d1 = false;
      if (!(i === 2 && cfg.freeSpaceCounts) && !effectiveMarked.has(`${4-i},${i}`)) d2 = false;
    }
    if (d1) diags++; if (d2) diags++;
    
    const total = rows + cols + diags;
    if (total >= (cfg.linesToWin || 1) && rows >= (cfg.minRows || 0) && cols >= (cfg.minColumns || 0) && diags >= (cfg.minDiagonals || 0)) {
      return 'rule_win';
    }
    return null;
  }
  async callBingo(userId, cardId) {
    console.log('🎯 BINGO VALIDATION STARTED - User:', userId, 'Card:', cardId);

    const game = await MainBingoGame.getActiveGame();
    if (!game) {
      console.log('❌ No active game');
      return { success: false, reason: 'No active game' };
    }
    if (game.status !== 'in_progress' && game.status !== 'bingo_called') {
      console.log('❌ Game not in progress. Status:', game.status);
      return { success: false, reason: 'Game not in progress' };
    }

    const card = await Card.findOne({ _id: cardId, userId, gameId: game._id });
    if (!card) {
      console.log('❌ Card not found');
      return { success: false, reason: 'Card not found' };
    }
    if (card.isBlocked) {
      console.log('❌ Card is blocked:', card.blockReason);
      return { success: false, reason: card.blockReason || 'Card is blocked' };
    }
    if (card.bingoCalled) {
      console.log('❌ BINGO already called');
      return { success: false, reason: 'BINGO already called' };
    }

    const drawnNumbers = game.drawnNumbers || [];
    console.log('📊 Drawn numbers:', drawnNumbers.length);

    // 🔥 Get config for last number check
    const config = await MainBingoConfig.findById(game.configId);

    // 🔥 Check if last called number is on the card
    if (config?.isLastNumberCalledBingo && drawnNumbers.length > 0) {
      const lastCalled = drawnNumbers[drawnNumbers.length - 1];
      const cell = card.grid[lastCalled.letter]?.find(c => c.number === lastCalled.number);
      
      if (!cell) {
        console.log('❌ Last called number NOT on card:', lastCalled.letter + lastCalled.number);
        card.isBlocked = true;
        card.blockReason = 'Last number ' + lastCalled.letter + lastCalled.number + ' not on card';
        await card.save();
        
        const roomId = this.getRoomId(game);
        this.io.to(roomId).emit('mainBingoFalseBingo', { 
          userId, 
          cardId, 
          cardNumber: card.cardNumber,
          displayId: card.displayId,
          reason: 'last_number_not_on_card',
          lastCalled: lastCalled.letter + lastCalled.number
        });
        return { success: false, reason: 'last_number_not_on_card' };
      }
      console.log('✅ Last number IS on card:', lastCalled.letter + lastCalled.number);
    }

    const rule = await MainBingoRule.findById(game.ruleId);
    if (!rule) {
      console.log('❌ Rule not found');
      return { success: false, reason: 'Rule not found' };
    }

    // 🔥 Pass config to checkWin
   const winType = this.checkWin(rule, card, drawnNumbers, config);
    
    if (!winType) {
      console.log('❌ No winning pattern');
      card.isBlocked = true;
      card.blockReason = 'no_win';
      await card.save();
      
      const roomId = this.getRoomId(game);
      this.io.to(roomId).emit('mainBingoFalseBingo', { 
        userId, 
        cardId,
        displayId: card.displayId,
        reason: 'no_win' 
      });
      return { success: false, reason: 'no_win' };
    }

    // ✅ VALID BINGO!
    console.log('✅ VALID BINGO! Type:', winType);
    card.bingoCalled = true;
    card.bingoCallTime = new Date();
    card.winType = winType;
    await card.save();

    const roomId = this.getRoomId(game);

    if (game.status === 'in_progress') {
      if (this.drawTimers.has(game._id.toString())) {
        clearInterval(this.drawTimers.get(game._id.toString()));
        this.drawTimers.delete(game._id.toString());
        console.log('🛑 Drawing stopped for first BINGO');
      }
      
      const gracePeriodSeconds = config?.gracePeriodSeconds || 10;
      
      game.status = 'bingo_called';
      game.gracePeriodEndTime = new Date(Date.now() + gracePeriodSeconds * 1000);
      await game.save();
      
      console.log(`⏳ Grace period started: ${gracePeriodSeconds}s`);
      
      this.io.to(roomId).emit('mainBingoFirstBingo', { 
        userId, cardId, winType,
        cardNumber: card.cardNumber,
        displayId: card.displayId
      });
      
      this.io.to(roomId).emit('mainBingoGracePeriod', { 
        seconds: gracePeriodSeconds, 
        endTime: game.gracePeriodEndTime,
        firstWinner: { userId, cardId, winType }
      });
      
      const graceTimer = setTimeout(() => this.endGracePeriod(game._id), gracePeriodSeconds * 1000);
      this.graceTimers.set(game._id.toString(), graceTimer);
      
    } else {
      console.log('📋 Additional BINGO during grace period');
      this.io.to(roomId).emit('mainBingoAdditionalBingo', { 
        userId, cardId, winType,
        cardNumber: card.cardNumber,
        displayId: card.displayId
      });
    }

    return { success: true, winType };
  }

  async endGracePeriod(gameId) {
    console.log('⏰ Grace period ended for game:', gameId);
    
    const game = await MainBingoGame.findById(gameId);
    if (!game || game.status === 'completed') {
      console.log('⚠️ Game already completed');
      return;
    }
    
    const roomId = this.getRoomId(game);
    
    if (this.drawTimers.has(game._id.toString())) {
      clearInterval(this.drawTimers.get(game._id.toString()));
      this.drawTimers.delete(game._id.toString());
    }
    if (this.graceTimers.has(game._id.toString())) {
      clearTimeout(this.graceTimers.get(game._id.toString()));
      this.graceTimers.delete(game._id.toString());
    }
    
    const calledCards = await Card.find({ 
      gameId: game._id, 
      bingoCalled: true, 
      isBlocked: false 
    }).populate('userId', 'fullName phone walletBalance');
    
    const rule = await MainBingoRule.findById(game.ruleId);
    const config = await MainBingoConfig.findById(game.configId);
    const winners = [];
    
    for (const card of calledCards) {
     if (this.checkWin(rule, card, game.drawnNumbers || [], config)) {
        card.bingoValidated = true;
        await card.save();
        
        winners.push({
    userId: card.userId._id,
    cardId: card._id,
    winnerName: card.userId.fullName,
    winnerPhone: card.userId.phone,
    cardNumber: card.cardNumber,
    displayId: card.displayId,
    winType: card.winType,
    
    cardGrid: card.grid,                    // ← ADD
        // ← ADD (user is already fetched above)
});
      }
    }
    
    console.log(`🏆 Winners: ${winners.length}`);
    
    if (winners.length > 0 && game.prizeAmount > 0) {
      const prizePerWinner = Math.floor(game.prizeAmount / winners.length);
      
      for (const winner of winners) {
        const user = await User.findById(winner.userId);
        const balanceBefore = user.walletBalance || 0;
        
        user.walletBalance = balanceBefore + prizePerWinner;
        await user.save();
        
        try {
          await Transaction.create({
            userId: winner.userId,
            type: 'prize_win',
            amount: prizePerWinner,
            gameId: game._id,
            cardId: winner.cardId,
            description: `BINGO win - Game #${game.gameNumber}`,
            balanceBefore: balanceBefore,
            balanceAfter: user.walletBalance,
            status: 'completed'
          });
          console.log(`💰 Prize paid to ${winner.winnerName}: ${prizePerWinner} ETB`);
        } catch (txError) {
          console.error('Transaction error:', txError.message);
        }
        
        winner.prizeAmount = prizePerWinner;
        game.winners.push(winner);
      }
    }
    
    game.status = 'completed';
    game.endTime = new Date();
    await game.save();
    
    await MainBingoConfig.findByIdAndUpdate(game.configId, { status: 'completed', completedAt: new Date() });
    await this.cleanupGameCards(game._id);
    
    this.io.to(roomId).emit('mainBingoEnded', { game, winners, showDuration: 10000 });
    
    console.log('✅ Game completed');
  }

  async cleanupGameCards(gameId) {
    try {
      console.log(`🧹 Cleaning up cards for game: ${gameId}`);
      
      const gameCards = await Card.find({ gameId: gameId });
      console.log(`   Found ${gameCards.length} cards for game`);
      
      let unmarkedCount = 0;
      for (const card of gameCards) {
        const cols = ['B', 'I', 'N', 'G', 'O'];
        for (const col of cols) {
          if (card.grid[col]) {
            card.grid[col] = card.grid[col].map(cell => ({
              ...cell,
              isMarked: cell.number === 0 ? true : false
            }));
          }
        }
        
        card.gameId = null;
        card.userId = null;
        card.status = 'preview';
        card.isBlocked = false;
        card.blockReason = null;
        card.bingoCalled = false;
        card.bingoCallTime = null;
        card.bingoValidated = false;
        card.winType = null;
        
        await card.save();
        unmarkedCount++;
      }
      
      console.log(`   ✅ ${unmarkedCount} cards reset`);
      return { success: true, releasedCount: unmarkedCount };
    } catch (error) {
      console.error('❌ Card cleanup error:', error);
      return { success: false, error: error.message };
    }
  }
}

MainBingoEngine.startDrawingIfNeeded = async function(io) {
  try {
    const game = await MainBingoGame.getActiveGame();
    if (game && game.status === 'in_progress') {
      console.log('🔄 Resuming drawing for game:', game.gameId);
      const engine = new MainBingoEngine(io);
      engine.drawNumbers(game);
    }
  } catch (e) { 
    console.error('❌ startDrawingIfNeeded error:', e); 
  }
};

module.exports = MainBingoEngine;