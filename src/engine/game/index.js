const Game = require('../../models/Game');
const GameConfig = require('../../models/GameConfig');
const Card = require('../../models/Card');
const User = require('../../models/User');
const Transaction = require('../../models/Transaction');
const timerManager = require('../../utils/TimerManager');

class GameFlowService {
  constructor(engine) { this.engine = engine; }

  startCountdown(roomId, game, config) {
    timerManager.clearTimeout(`countdown_${roomId}`);
    timerManager.clearInterval(`poll_${roomId}`);
    
    timerManager.createTimeout(`countdown_${roomId}`, async () => {
      const current = await Game.findById(game._id);
      if (!current || current.status === 'completed') return;
      
      const playerCount = current.players ? current.players.length : 0;
      
      if (playerCount >= config.minPlayersToStart) {
        await this.startGame(roomId, current, config);
      } else if (playerCount === 0 && config.resetOnNoPlayers) {
        current.timerStartedAt = new Date(); current.status = 'waiting';
        await current.save();
        this.engine.io.to(roomId).emit('countdownReset', { timerStartedAt: current.timerStartedAt, timerDuration: config.waitTimeSeconds });
        this.startCountdown(roomId, current, config);
      } else {
        this.startPlayerPoll(roomId, current, config);
      }
    }, config.waitTimeSeconds * 1000, 'game_countdown');
  }

  startPlayerPoll(roomId, game, config) {
    const pc = this.engine.getPlayerCount(game);
    this.engine.io.to(roomId).emit('waitingForPlayers', { needPlayers: config.minPlayersToStart - pc });
    
    timerManager.createInterval(`poll_${roomId}`, async () => {
      const updated = await Game.findById(game._id);
      if (!updated || updated.status === 'completed') { timerManager.clearInterval(`poll_${roomId}`); return; }
      
      const currentPlayers = updated.players ? updated.players.length : 0;
      
      if (currentPlayers >= config.minPlayersToStart) {
        timerManager.clearInterval(`poll_${roomId}`);
        await this.startGame(roomId, updated, config);
      } else if (currentPlayers === 0 && config.resetOnNoPlayers) {
        timerManager.clearInterval(`poll_${roomId}`);
        updated.timerStartedAt = new Date(); await updated.save();
        this.engine.io.to(roomId).emit('countdownReset', { timerStartedAt: updated.timerStartedAt });
        this.startCountdown(roomId, updated, config);
      }
    }, 3000, 'player_poll');
  }

  async verifyAndFixGame(roomId) {
    const game = await Game.getActiveGame(roomId);
    if (!game) return { error: 'No active game' };
    
    const cards = await Card.find({ gameId: game._id, status: 'registered' });
    const calculatedTotalCards = cards.length;
    const calculatedPrizePool = cards.reduce((sum, card) => sum + card.price, 0);
    const uniquePlayers = new Set(cards.map(c => c.userId.toString()));
    
    let needsFix = false;
    if (game.totalCards !== calculatedTotalCards) { game.totalCards = calculatedTotalCards; needsFix = true; }
    if (game.prizePool !== calculatedPrizePool) { game.prizePool = calculatedPrizePool; needsFix = true; }
    if (game.players?.length !== uniquePlayers.size) {
      const playerMap = new Map();
      for (const card of cards) {
        const uid = card.userId.toString();
        if (!playerMap.has(uid)) playerMap.set(uid, []);
        playerMap.get(uid).push(card._id);
      }
      game.players = Array.from(playerMap.entries()).map(([userId, cardIds]) => ({ userId, cards: cardIds }));
      needsFix = true;
    }
    
    if (needsFix) {
      await game.save();
      this.engine.io.to(roomId).emit('gameStateCorrected', { totalCards: game.totalCards, prizePool: game.prizePool, playerCount: game.players.length });
    }
    
    return { totalCards: game.totalCards, prizePool: game.prizePool, playerCount: game.players.length, needsFix };
  }

  async startGame(roomId, game, config) {
    await this.verifyAndFixGame(roomId);
    
    timerManager.clearInterval(`poll_${roomId}`);
    game.status = 'in_progress'; game.startTime = new Date(); await game.save();
    
    this.engine.io.to(roomId).emit('gameStarted', {
      gameId: game.gameId, gameNumber: game.gameNumber,
      prizePool: game.prizePool, playerCount: this.engine.getPlayerCount(game), totalCards: game.totalCards
    });
    
    this.drawNumbers(roomId, game, config);
  }

  drawNumbers(roomId, game, config) {
    let idx = 0;
    timerManager.clearInterval(`draw_${roomId}`);
    
    timerManager.createInterval(`draw_${roomId}`, async () => {
      const current = await Game.findById(game._id);
      if (!current || current.status === 'completed' || current.status === 'grace_period') {
        timerManager.clearInterval(`draw_${roomId}`); return;
      }
      
      if (idx >= current.allNumbers.length) {
        timerManager.clearInterval(`draw_${roomId}`);
        await this.endGame(roomId, current);
        return;
      }
      
      const activeCards = await Card.countDocuments({ gameId: current._id, status: 'registered', isBlocked: false, bingoCalled: false });
      
      if (activeCards === 0 && current.totalCards > 0) {
        timerManager.clearInterval(`draw_${roomId}`);
        const cards = await Card.find({ gameId: current._id, status: 'registered' });
        for (const card of cards) {
          const user = await User.findById(card.userId);
          if (user) {
            user.walletBalance += card.price; await user.save();
            await Transaction.create({
              userId: user._id, type: 'refund', amount: card.price,
              gameId: current.gameId, gameNumber: current.gameNumber,
              description: `Refund - all cards blocked`, balanceAfter: user.walletBalance
            });
            this.engine.notifications.sendRefund(user._id, card.price, current.gameNumber, 'All cards blocked');
          }
        }
        current.status = 'completed'; current.endTime = new Date(); current.endReason = 'all_cards_blocked';
        await current.save();
        this.engine.io.to(roomId).emit('gameEnded', { gameId: current._id, winners: [], prizePool: current.prizePool, reason: 'All cards blocked', refunded: true });
        return;
      }
      
      const num = current.allNumbers[idx], letter = this.engine.getBingoLetter(num);
      current.currentNumber = { number: num, letter };
      current.drawnNumbers.push({ number: num, letter });
      await current.save();
      
      this.engine.io.to(roomId).emit('numberDrawn', { number: num, letter, drawCount: idx + 1, totalNumbers: current.allNumbers.length });
      
      // Auto-BINGO check
      const config = await GameConfig.findOne({ roomId });
      if (config?.autoBingoEnabled) {
        const allRegisteredCards = await Card.find({ gameId: current._id, status: 'registered', isBlocked: false, bingoCalled: false });
        for (const card of allRegisteredCards) {
          const winType = this.engine.bingo.checkWin(card, current.drawnNumbers, config);
          if (winType) {
            card.bingoCalled = true; card.bingoCallTime = new Date(); card.winType = winType;
            await card.save();
            if (current.status === 'in_progress') {
              timerManager.clearInterval(`draw_${roomId}`);
              current.status = 'bingo_called';
              current.gracePeriodEndTime = new Date(Date.now() + (config.gracePeriodSeconds || 10) * 1000);
              await current.save();
              this.engine.io.to(roomId).emit('firstBingo', { userId: card.userId, cardId: card._id, cardNumber: card.cardNumber, winType, autoBingo: true });
              timerManager.createTimeout(`grace_${roomId}`, () => this.endGracePeriod(roomId, current._id), (config.gracePeriodSeconds || 10) * 1000, 'grace_period');
              return;
            } else {
              this.engine.io.to(roomId).emit('additionalBingo', { userId: card.userId, cardId: card._id, cardNumber: card.cardNumber, winType, autoBingo: true });
            }
          }
        }
      }
      
      idx++;
    }, config.drawIntervalSeconds * 1000, 'number_draw');
  }

  async endGracePeriod(roomId, gameId) {
    const game = await Game.findById(gameId);
    if (!game || game.status === 'completed') return;
    
    const config = await GameConfig.findOne({ roomId: game.roomId });
    const calledCards = await Card.find({ gameId: game._id, bingoCalled: true, isBlocked: false }).populate('userId');
    
    const winners = [];
    for (const card of calledCards) {
      const wt = this.engine.bingo.checkWin(card, game.drawnNumbers, config);
      if (wt) { card.bingoValidated = true; await card.save(); winners.push({ card, winType: wt }); }
    }
    
    if (winners.length > 0) {
      const commissionRate = config?.commissionPercentage || 10;
      const comm = (game.prizePool * commissionRate) / 100;
      const ppw = (game.prizePool - comm) / winners.length;
      
      for (const { card, winType } of winners) {
        const user = card.userId;
        await User.findByIdAndUpdate(user._id, { $inc: { walletBalance: ppw } });
        const updatedUser = await User.findById(user._id);
        
        await Transaction.create({
          userId: user._id, type: 'prize_win', amount: ppw,
          gameId: game.gameId, gameNumber: game.gameNumber,
          description: `Won with ${winType}`, balanceAfter: updatedUser.walletBalance
        });
        
        game.winners.push({
          userId: user._id, cardId: card._id, winType, prizeAmount: ppw,
          winnerName: user.fullName, winnerPhone: user.phone,
          cardNumber: card.cardNumber, cardGrid: card.grid, newBalance: updatedUser.walletBalance
        });
        
        this.engine.notifications.sendWinning(user._id, ppw, game.gameNumber, winType);
      }
      
      await Transaction.create({ type: 'commission', amount: comm, gameId: game.gameId, gameNumber: game.gameNumber, description: 'Commission' });
      game.commission = comm;
    }
    
    game.status = 'completed'; game.endTime = new Date(); await game.save();
    
    // Reset all 400 cards
    await Card.updateMany({ displayId: { $gte: 10001, $lte: 10400 } }, { $set: { status: 'available', userId: null, gameId: null, isBlocked: false, bingoCalled: false } });
    
    const allCards = await Card.find({ displayId: { $gte: 10001, $lte: 10400 } });
    for (const c of allCards) {
      ['B', 'I', 'N', 'G', 'O'].forEach(col => {
        if (c.grid[col]) c.grid[col] = c.grid[col].map(cell => ({ ...cell, isMarked: cell.number === 0 }));
      });
      await c.save();
    }
    
    timerManager.clearInterval(`draw_${roomId}`);
    timerManager.clearTimeout(`grace_${roomId}`);
    
    this.engine.io.to(roomId).emit('gameEnded', { gameId: game._id, winners: game.winners, prizePool: game.prizePool, commission: game.commission, balance: game.winners[0]?.newBalance || 0 });
    
    setTimeout(async () => {
      const conf = await GameConfig.findOne({ roomId: game.roomId });
      if (conf) {
        const ln = await Game.getLatestGameNumber(roomId);
        const ng = await Game.create({ gameId: String(ln + 1).padStart(10, '0'), gameNumber: ln + 1, roomId, status: 'scheduled', allNumbers: this.engine.shuffleNumbers(), timerDuration: conf.waitTimeSeconds });
        this.engine.games.set(roomId, ng);
        this.engine.io.to(roomId).emit('newGameCreated', { gameId: ng.gameId, gameNumber: ng.gameNumber });
      }
    }, 5000);
  }

  async endGame(roomId, game) {
    game.status = 'completed'; game.endTime = new Date(); game.endReason = game.endReason || 'all_numbers_drawn';
    await game.save();
    
    await Card.updateMany({ displayId: { $gte: 10001, $lte: 10400 } }, { $set: { status: 'available', userId: null, gameId: null, isBlocked: false, bingoCalled: false } });
    
    const allCards = await Card.find({ displayId: { $gte: 10001, $lte: 10400 } });
    for (const c of allCards) {
      ['B', 'I', 'N', 'G', 'O'].forEach(col => {
        if (c.grid[col]) c.grid[col] = c.grid[col].map(cell => ({ ...cell, isMarked: cell.number === 0 }));
      });
      await c.save();
    }
    
    timerManager.clearInterval(`draw_${roomId}`);
    
    const cards = await Card.find({ gameId: game._id, status: 'registered' });
    let totalRefunded = 0;
    
    for (const card of cards) {
      const user = await User.findById(card.userId);
      if (user) {
        user.walletBalance += card.price; await user.save(); totalRefunded += card.price;
        await Transaction.create({
          userId: user._id, type: 'refund', amount: card.price,
          gameId: game.gameId, gameNumber: game.gameNumber,
          description: `Refund - no winner`, balanceAfter: user.walletBalance
        });
        this.engine.notifications.sendRefund(user._id, card.price, game.gameNumber, 'No winner');
      }
    }
    
    this.engine.io.to(roomId).emit('gameEnded', { gameId: game._id, winners: [], prizePool: game.prizePool, reason: 'No winner', refunded: true, totalRefunded, balance: totalRefunded > 0 ? undefined : 0 });
    
    setTimeout(async () => {
      const conf = await GameConfig.findOne({ roomId: game.roomId });
      if (conf) {
        const ln = await Game.getLatestGameNumber(game.roomId);
        const ng = await Game.create({ gameId: String(ln + 1).padStart(10, '0'), gameNumber: ln + 1, roomId: game.roomId, status: 'scheduled', allNumbers: this.engine.shuffleNumbers(), timerDuration: conf.waitTimeSeconds });
        this.engine.games.set(game.roomId, ng);
        this.engine.io.to(game.roomId).emit('newGameCreated', { gameId: ng.gameId, gameNumber: ng.gameNumber });
      }
    }, 5000);
  }
}

module.exports = GameFlowService;