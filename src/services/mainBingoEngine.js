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
    return 'main-bingo-room';
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
          
          await MainBingoGame.findByIdAndUpdate(game._id, {
            status: 'grace_period',
            gracePeriodEndTime: new Date(Date.now() + gracePeriodSeconds * 1000)
          });
          
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
        
        // Batch save to MongoDB every 5 numbers
        if (idx % 5 === 0 || idx === allNumbers.length - 1) {
          const startBatch = idx - (idx % 5);
          const batchNumbers = allNumbers.slice(startBatch, idx + 1).map(n => ({
            number: n,
            letter: this.getBingoLetter(n),
            drawnAt: new Date()
          }));
          
          await MainBingoGame.findByIdAndUpdate(game._id, {
            $push: { drawnNumbers: { $each: batchNumbers } },
            currentNumber: { number: num, letter }
          });
        }
        
        // Emit immediately
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
    
    if (config?.isLastNumberCalledBingo && drawnNumbers.length > 0) {
      const lastCalled = drawnNumbers[drawnNumbers.length - 1];
      const lastCell = card.grid[lastCalled.letter]?.find(c => c.number === lastCalled.number);
      if (!lastCell) return null;
    }
    
    if (rule.method === 'pattern') {
      for (const pattern of rule.patterns) {
        if (pattern.cells.every(c => {
          const cell = card.grid[COLS[c[1]]][c[0]];
          const cellNumber = cell.number;
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
        if (!drawnSet.has(card.grid[COLS[c]][r].number)) { ok = false; break; }
      }
      if (ok) rows++;
    }
    
    for (let c = 0; c < 5; c++) {
      let ok = true;
      for (let r = 0; r < 5; r++) {
        if (c === 2 && r === 2 && cfg.freeSpaceCounts) continue;
        if (!drawnSet.has(card.grid[COLS[c]][r].number)) { ok = false; break; }
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
    if (total >= (cfg.linesToWin || 1) && 
        rows >= (cfg.minRows || 0) && 
        cols >= (cfg.minColumns || 0) && 
        diags >= (cfg.minDiagonals || 0)) {
      return 'rule_win';
    }
    return null;
  }

  async callBingo(userId, cardId) {
    console.log('🎯 BINGO VALIDATION STARTED - User:', userId, 'Card:', cardId);

    const game = await MainBingoGame.getActiveGame();
    if (!game) return { success: false, reason: 'No active game' };
    if (game.status !== 'in_progress' && game.status !== 'bingo_called') {
      return { success: false, reason: 'Game not in progress' };
    }

    const card = await Card.findOne({ _id: cardId, userId, gameId: game._id });
    if (!card) return { success: false, reason: 'Card not found' };
    if (card.isBlocked) return { success: false, reason: card.blockReason || 'Card is blocked' };
    if (card.bingoCalled) return { success: false, reason: 'BINGO already called' };

    const drawnNumbers = game.drawnNumbers || [];
    const config = await MainBingoConfig.findById(game.configId);

    if (config?.isLastNumberCalledBingo && drawnNumbers.length > 0) {
      const lastCalled = drawnNumbers[drawnNumbers.length - 1];
      const cell = card.grid[lastCalled.letter]?.find(c => c.number === lastCalled.number);
      if (!cell) {
        card.isBlocked = true;
        card.blockReason = 'Last number not on card';
        await card.save();
        const roomId = this.getRoomId(game);
        this.io.to(roomId).emit('mainBingoFalseBingo', { userId, cardId, reason: 'last_number_not_on_card' });
        return { success: false, reason: 'last_number_not_on_card' };
      }
    }

    const rule = await MainBingoRule.findById(game.ruleId);
    if (!rule) return { success: false, reason: 'Rule not found' };

    const winType = this.checkWin(rule, card, drawnNumbers, config);
    
    if (!winType) {
      card.isBlocked = true;
      card.blockReason = 'no_win';
      await card.save();
      const roomId = this.getRoomId(game);
      this.io.to(roomId).emit('mainBingoFalseBingo', { userId, cardId, reason: 'no_win' });
      return { success: false, reason: 'no_win' };
    }

    card.bingoCalled = true;
    card.bingoCallTime = new Date();
    card.winType = winType;
    await card.save();

    const roomId = this.getRoomId(game);

    if (game.status === 'in_progress') {
      if (this.drawTimers.has(game._id.toString())) {
        clearInterval(this.drawTimers.get(game._id.toString()));
        this.drawTimers.delete(game._id.toString());
      }
      
      const gracePeriodSeconds = config?.gracePeriodSeconds || 10;
      game.status = 'bingo_called';
      game.gracePeriodEndTime = new Date(Date.now() + gracePeriodSeconds * 1000);
      await game.save();
      
      this.io.to(roomId).emit('mainBingoFirstBingo', { userId, cardId, winType, cardNumber: card.cardNumber });
      this.io.to(roomId).emit('mainBingoGracePeriod', { seconds: gracePeriodSeconds, endTime: game.gracePeriodEndTime });
      
      const graceTimer = setTimeout(() => this.endGracePeriod(game._id), gracePeriodSeconds * 1000);
      this.graceTimers.set(game._id.toString(), graceTimer);
    } else {
      this.io.to(roomId).emit('mainBingoAdditionalBingo', { userId, cardId, winType, cardNumber: card.cardNumber });
    }

    return { success: true, winType };
  }

  async endGracePeriod(gameId) {
    console.log('⏰ Grace period ended for game:', gameId);
    
    const game = await MainBingoGame.findById(gameId);
    if (!game || game.status === 'completed') return;
    
    const roomId = this.getRoomId(game);
    
    if (this.drawTimers.has(game._id.toString())) {
      clearInterval(this.drawTimers.get(game._id.toString()));
      this.drawTimers.delete(game._id.toString());
    }
    if (this.graceTimers.has(game._id.toString())) {
      clearTimeout(this.graceTimers.get(game._id.toString()));
      this.graceTimers.delete(game._id.toString());
    }
    
    const calledCards = await Card.find({ gameId: game._id, bingoCalled: true, isBlocked: false })
      .populate('userId', 'fullName phone walletBalance');
    
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
          cardGrid: card.grid,
        });
      }
    }
    
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
        } catch (txError) {}
        
        winner.prizeAmount = prizePerWinner;
        winner.newBalance = user.walletBalance;
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
      const gameCards = await Card.find({ gameId: gameId });
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
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = MainBingoEngine;