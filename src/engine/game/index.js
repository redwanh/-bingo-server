const Game = require('../../models/Game');
const GameConfig = require('../../models/GameConfig');
const Card = require('../../models/Card');
const User = require('../../models/User');
const Transaction = require('../../models/Transaction');
const timerManager = require('../../utils/TimerManager');

class GameFlowService {
  constructor(engine) {
    this.engine = engine;
    this.activeCardCounts = new Map();
  }

  async resetAllCards(roomId) {
    console.log('🔄 [RESET] Resetting all cards to initial state...');
    const startTime = Date.now();
    const allCards = await Card.find({ displayId: { $gte: 10001, $lte: 10400 } }, { grid: 1 }).lean();
    if (allCards.length === 0) { console.log('⚠️ [RESET] No cards found to reset'); return; }
    
    const bulkOps = allCards.map(card => {
      const setFields = { status: 'available', userId: null, gameId: null, isBlocked: false, bingoCalled: false, bingoValidated: false, winType: null, reservedBy: null, reservedAt: null, registeredAt: null };
      ['B', 'I', 'N', 'G', 'O'].forEach(col => {
        if (card.grid && card.grid[col]) {
          setFields[`grid.${col}`] = card.grid[col].map(cell => ({ ...cell, isMarked: cell.number === 0 }));
        }
      });
      return { updateOne: { filter: { _id: card._id }, update: { $set: setFields } } };
    });
    
    if (bulkOps.length > 0) {
      const result = await Card.bulkWrite(bulkOps, { ordered: false });
      console.log(`✅ [RESET] ${result.modifiedCount} cards reset in ${Date.now() - startTime}ms`);
    }
    this.activeCardCounts.clear();
  }

  startCountdown(roomId, game, config) {
    console.log(`\n⏱️ [COUNTDOWN] Starting - ${config.waitTimeSeconds}s for Game #${game.gameNumber}`);
    timerManager.clearTimeout(`countdown_${roomId}`);
    timerManager.clearInterval(`poll_${roomId}`);
    timerManager.clearInterval(`tick_${roomId}`);

    this.engine.io.to(roomId).emit('countdownStarted', {
      timerStartedAt: new Date().toISOString(), timerDuration: config.waitTimeSeconds,
      gameId: game.gameId || game._id, gameNumber: game.gameNumber,
    });

    const startTime = Date.now();
    const durationMs = config.waitTimeSeconds * 1000;

    timerManager.createInterval(`tick_${roomId}`, () => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, Math.ceil((durationMs - elapsed) / 1000));
      this.engine.io.to(roomId).emit('countdownTick', { remaining, totalDuration: config.waitTimeSeconds });
      if (remaining <= 0) timerManager.clearInterval(`tick_${roomId}`);
    }, 1000, 'countdown_tick');

    timerManager.createTimeout(`countdown_${roomId}`, async () => {
      try {
        timerManager.clearInterval(`tick_${roomId}`);
        const current = await Game.findById(game._id);
        if (!current || current.status === "completed") return;
        const playerCount = current.players ? current.players.length : 0;
        if (playerCount >= config.minPlayersToStart) {
          await this.startGame(roomId, current, config);
        } else if (playerCount === 0 && config.resetOnNoPlayers) {
          current.timerStartedAt = new Date(); current.status = "waiting"; await current.save();
          this.engine.io.to(roomId).emit("countdownReset", { timerStartedAt: current.timerStartedAt, timerDuration: config.waitTimeSeconds });
          this.startCountdown(roomId, current, config);
        } else {
          this.startPlayerPoll(roomId, current, config);
        }
      } catch (e) { console.error(`❌ [COUNTDOWN] Error:`, e); }
    }, durationMs, "game_countdown");
  }

  startPlayerPoll(roomId, game, config) {
    const pc = this.engine.getPlayerCount(game);
    this.engine.io.to(roomId).emit('waitingForPlayers', { needPlayers: config.minPlayersToStart - pc });
    timerManager.createInterval(`poll_${roomId}`, async () => {
      const updated = await Game.findById(game._id).lean();
      if (!updated || updated.status === 'completed') { timerManager.clearInterval(`poll_${roomId}`); return; }
      const currentPlayers = updated.players ? updated.players.length : 0;
      if (currentPlayers >= config.minPlayersToStart) {
        timerManager.clearInterval(`poll_${roomId}`);
        await this.startGame(roomId, await Game.findById(updated._id), config);
      } else if (currentPlayers === 0 && config.resetOnNoPlayers) {
        timerManager.clearInterval(`poll_${roomId}`);
        await Game.updateOne({ _id: updated._id }, { $set: { timerStartedAt: new Date() } });
        this.engine.io.to(roomId).emit('countdownReset', { timerStartedAt: new Date() });
        this.startCountdown(roomId, await Game.findById(updated._id), config);
      }
    }, 3000, 'player_poll');
  }

  async startGame(roomId, game, config) {
    timerManager.clearInterval(`poll_${roomId}`);
    this.engine.io.to(roomId).emit('gameStarted', {
      gameId: game.gameId || game._id, gameNumber: game.gameNumber,
      prizePool: game.prizePool, playerCount: this.engine.getPlayerCount(game), totalCards: game.totalCards
    });
    Game.updateOne({ _id: game._id }, { $set: { status: 'in_progress', startTime: new Date() } }).catch(() => {});
    this.drawNumbers(roomId, game, config);
  }

  drawNumbers(roomId, game, config) {
    let idx = 1;
    const gameId = game._id || game.gameId;
    let cachedGame = game;
    let activeCountCache = null;
    timerManager.clearInterval(`draw_${roomId}`);

    Card.countDocuments({ gameId, status: 'registered', isBlocked: false, bingoCalled: false }).then(count => {
      activeCountCache = count;
      this.activeCardCounts.set(gameId.toString(), count);
    });

    timerManager.createInterval(`draw_${roomId}`, async () => {
      if (idx % 10 === 0 || !cachedGame) {
        const fresh = await Game.findById(gameId).lean();
        if (!fresh || fresh.status === 'completed' || fresh.status === 'grace_period') { timerManager.clearInterval(`draw_${roomId}`); return; }
        cachedGame = fresh;
      }
      if (idx >= cachedGame.allNumbers.length) {
        timerManager.clearInterval(`draw_${roomId}`);
        await this.endGame(roomId, await Game.findById(gameId));
        return;
      }
      if (idx % 10 === 0 || activeCountCache === null || activeCountCache < 5) {
        activeCountCache = await Card.countDocuments({ gameId, status: 'registered', isBlocked: false, bingoCalled: false });
        this.activeCardCounts.set(gameId.toString(), activeCountCache);
      }
      if (activeCountCache === 0 && cachedGame.totalCards > 0) {
        timerManager.clearInterval(`draw_${roomId}`);
        const cards = await Card.find({ gameId, status: 'registered' });
        for (const card of cards) {
          const user = await User.findById(card.userId);
          if (user) { user.walletBalance += card.price; await user.save(); await Transaction.create({ userId: user._id, type: 'refund', amount: card.price, gameId: cachedGame.gameId, gameNumber: cachedGame.gameNumber, description: 'Refund - all cards blocked', balanceAfter: user.walletBalance }); }
        }
        await Game.updateOne({ _id: gameId }, { $set: { status: 'completed', endTime: new Date(), endReason: 'all_cards_blocked' } });
        await this.resetAllCards(roomId);
        this.engine.io.to(roomId).emit('gameEnded', { gameId: cachedGame._id, winners: [], prizePool: cachedGame.prizePool, reason: 'All cards blocked', refunded: true });
        this.scheduleNewGame(roomId);
        return;
      }
      const num = cachedGame.allNumbers[idx];
      const letter = this.engine.getBingoLetter(num);
      if (!cachedGame.drawnNumbers) cachedGame.drawnNumbers = [];
      cachedGame.drawnNumbers.push({ number: num, letter });
      cachedGame.currentNumber = { number: num, letter };
      
      // 🔥 ONLY ONE EMIT
      this.engine.io.to(roomId).emit('numberDrawn', { number: num, letter, drawCount: idx + 1, totalNumbers: cachedGame.allNumbers.length });
      
      Game.updateOne({ _id: gameId }, { $set: { currentNumber: { number: num, letter } }, $push: { drawnNumbers: { number: num, letter } } }).catch(() => {});

      if (config?.autoBingoEnabled && idx >= 4) {
        const allRegisteredCards = await Card.find({ gameId, status: 'registered', isBlocked: false, bingoCalled: false }).lean();
        if (allRegisteredCards.length > 0) {
          const results = this.engine.bingo.checkMultipleCards(allRegisteredCards, cachedGame.drawnNumbers, config);
          for (const { cardId, winType } of results) {
            if (winType) {
              const card = allRegisteredCards.find(c => c._id.toString() === cardId.toString());
              if (!card) continue;
              await Card.updateOne({ _id: card._id }, { $set: { bingoCalled: true, bingoCallTime: new Date(), winType } });
              const fullGame = await Game.findById(gameId);
              if (fullGame.status === 'in_progress') {
                timerManager.clearInterval(`draw_${roomId}`);
                const graceEndTime = new Date(Date.now() + (config.gracePeriodSeconds || 10) * 1000);
                await Game.updateOne({ _id: gameId }, { $set: { status: 'grace_period', gracePeriodEndTime: graceEndTime } });
                this.engine.io.to(roomId).emit('firstBingo', { userId: card.userId, cardId: card._id, cardNumber: card.cardNumber, winType, autoBingo: true });
                this.engine.io.to(roomId).emit('gracePeriodStarted', { seconds: config.gracePeriodSeconds || 10, endTime: graceEndTime });
                timerManager.createTimeout(`grace_${roomId}`, () => this.endGracePeriod(roomId, gameId), (config.gracePeriodSeconds || 10) * 1000, 'grace_period');
                return;
              } else {
                this.engine.io.to(roomId).emit('additionalBingo', { userId: card.userId, cardId: card._id, cardNumber: card.cardNumber, winType, autoBingo: true });
              }
            }
          }
        }
      }
      idx++;
    }, config.drawIntervalSeconds * 1000, 'number_draw');
  }

async endGracePeriod(roomId, gameId) {
    let game = await Game.findById(gameId);
    if (!game || game.status === 'completed') return;
    if (game.status === 'bingo_called') { game.status = 'grace_period'; game.gracePeriodEndTime = new Date(); await game.save(); }
    const config = await GameConfig.findOne({ roomId: game.roomId }).lean();
    const calledCards = await Card.find({ gameId: game._id, bingoCalled: true, isBlocked: false }).populate('userId').lean();
    const winCheckPromises = calledCards.map(card => this.engine.bingo.checkWin(card, game.drawnNumbers, config));
    const winResults = await Promise.all(winCheckPromises);
    const winners = [];
    const cardUpdates = [];
    for (let i = 0; i < calledCards.length; i++) {
      if (winResults[i]) { cardUpdates.push({ updateOne: { filter: { _id: calledCards[i]._id }, update: { $set: { bingoValidated: true } } } }); winners.push({ card: calledCards[i], winType: winResults[i] }); }
    }
    if (cardUpdates.length > 0) await Card.bulkWrite(cardUpdates, { ordered: false });

    if (winners.length > 0) {
      const commissionRate = config?.commissionPercentage || 10;
      const comm = (game.prizePool * commissionRate) / 100;
      const ppw = (game.prizePool - comm) / winners.length;
      const userUpdates = [], transactionOps = [], winnerEntries = [];
      const systemUser = await User.findOne({ role: 'superadmin' }) || await User.findOne({ role: 'admin' });

      for (const { card, winType } of winners) {
        userUpdates.push({ updateOne: { filter: { _id: card.userId._id || card.userId }, update: { $inc: { walletBalance: ppw } } } });
        const user = await User.findById(card.userId._id || card.userId);
        transactionOps.push({ userId: user._id, type: 'prize_win', amount: ppw, gameId: game.gameId, gameNumber: game.gameNumber, description: `Won with ${winType}`, balanceAfter: (user.walletBalance || 0) + ppw });
        const markedGrid = markWinningCells(card.grid, game.drawnNumbers);
        winnerEntries.push({ userId: user._id, cardId: card._id, winType, prizeAmount: ppw, winnerName: user.fullName, winnerPhone: user.phone, cardNumber: card.cardNumber, cardGrid: markedGrid, newBalance: (user.walletBalance || 0) + ppw });
      }
      await User.bulkWrite(userUpdates, { ordered: false });
      await Transaction.insertMany(transactionOps);
      await Transaction.create({ userId: systemUser?._id || winners[0]?.card?.userId?._id, type: 'commission', amount: comm, gameId: game.gameId, gameNumber: game.gameNumber, description: 'Commission' });
      await Game.updateOne({ _id: gameId }, { $set: { winners: winnerEntries, commission: comm, status: 'completed', endTime: new Date() } });

      // 🔥 Emit updated balance to EACH winner instantly
      for (const { card } of winners) {
        const winnerUser = await User.findById(card.userId._id || card.userId);
        const userSocket = this.engine.getUserSocket(winnerUser._id.toString());
        if (userSocket) {
          this.engine.io.to(userSocket).emit('balanceUpdated', { newBalance: winnerUser.walletBalance });
        }
      }
    } else {
      await Game.updateOne({ _id: gameId }, { $set: { status: 'completed', endTime: new Date() } });
    }
    await this.resetAllCards(roomId);
    timerManager.clearInterval(`draw_${roomId}`); timerManager.clearTimeout(`grace_${roomId}`); timerManager.clearInterval(`poll_${roomId}`); timerManager.clearTimeout(`countdown_${roomId}`);
    const finalGame = await Game.findById(gameId).lean();
    this.engine.io.to(roomId).emit('gameEnded', { gameId: game._id, winners: finalGame.winners || [], prizePool: game.prizePool, commission: finalGame.commission || 0, balance: finalGame.winners?.[0]?.newBalance || 0 });
    this.scheduleNewGame(roomId);
  }

  async endGame(roomId, game) {
    await Game.updateOne({ _id: game._id }, { $set: { status: 'completed', endTime: new Date(), endReason: game.endReason || 'all_numbers_drawn' } });
    await this.resetAllCards(roomId);
    timerManager.clearInterval(`draw_${roomId}`);
    const cards = await Card.find({ gameId: game._id, status: 'registered' }).lean();
    if (cards.length > 0) {
      const userUpdates = [], transactions = [];
      for (const card of cards) {
        userUpdates.push({ updateOne: { filter: { _id: card.userId }, update: { $inc: { walletBalance: card.price } } } });
        const user = await User.findById(card.userId).lean();
        if (user) transactions.push({ userId: user._id, type: 'refund', amount: card.price, gameId: game.gameId, gameNumber: game.gameNumber, description: 'Refund - no winner', balanceAfter: user.walletBalance + card.price });
      }
      if (userUpdates.length > 0) await User.bulkWrite(userUpdates, { ordered: false });
      if (transactions.length > 0) await Transaction.insertMany(transactions);
    }
    this.engine.io.to(roomId).emit('gameEnded', { gameId: game._id, winners: [], prizePool: game.prizePool, reason: 'No winner', refunded: true });
    this.scheduleNewGame(game.roomId);
  }

  async scheduleNewGame(roomId) {
    setTimeout(async () => {
      const conf = await GameConfig.findOne({ roomId }).lean();
      if (conf) {
        const ln = await Game.getLatestGameNumber(roomId);
        const ng = await Game.create({ gameId: String(ln + 1).padStart(10, '0'), gameNumber: ln + 1, roomId, status: 'scheduled', allNumbers: this.engine.shuffleNumbers(), timerDuration: conf.waitTimeSeconds });
        this.engine.games.set(roomId, ng);
        this.engine.io.to(roomId).emit('newGameCreated', { gameId: ng.gameId, gameNumber: ng.gameNumber });
      }
    }, 1000);
  }
    // ... end of scheduleNewGame ...

  // 🔥 ADD THE NEW METHOD HERE
async getGameState(roomId, userId) {
    const game = await Game.getActiveGame(roomId);
    if (!game) return null;
    
    const config = await GameConfig.findOne({ roomId }).lean();
    const myCards = userId 
        ? await Card.find({ gameId: game._id, userId, status: 'registered' }).lean()
        : [];
    
    // 🔥 Get ALL registered/sold card IDs for this game
    const soldCards = await Card.find({ 
        gameId: game._id, 
        status: { $in: ['registered', 'sold'] } 
    }).select('_id').lean();
    const soldCardIds = soldCards.map(c => c._id.toString());
    
    return {
        // ... existing fields ...
        myCards,
        soldCardIds,  // 🔥 Send to frontend
        winners: game.winners || [],
    };
}
} // ← This is the class closing bracket




function markWinningCells(grid, drawnNumbers) {
  const drawnSet = new Set(drawnNumbers.map(d => d.number));
  const markedGrid = {};
  ['B', 'I', 'N', 'G', 'O'].forEach(col => {
    if (grid[col]) markedGrid[col] = grid[col].map(cell => ({ ...cell, isMarked: drawnSet.has(cell.number) || cell.number === 0, isWinningCell: drawnSet.has(cell.number) && cell.number !== 0 }));
  });
  return markedGrid;
}

module.exports = GameFlowService;