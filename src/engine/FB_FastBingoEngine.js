// ============================================================
// server/src/engine/FB_FastBingoEngine.js
// Fast Bingo Game Engine - Single file, all logic
// ============================================================

const Game = require('../models/FB_Game');
const Card = require('../models/FB_Card');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const GameConfig = require('../models/GameConfig');

// 🔥 Helper: Mark drawn numbers on a card grid
function markGridWithDrawn(grid, drawnNumbers) {
  if (!grid || !drawnNumbers?.length) return grid;
  const drawnSet = new Set(drawnNumbers.map(d => d.number));
  const marked = {};
  ['B', 'I', 'N', 'G', 'O'].forEach(col => {
    if (grid[col]) {
      marked[col] = grid[col].map(cell => ({
        ...cell,
        isMarked: cell.number === 0 || drawnSet.has(cell.number),
      }));
    }
  });
  return marked;
}

// 🔥 Business-friendly error messages
const ERRORS = {
  GAME_NOT_OPEN: 'Registration is currently closed. Please wait for the next game to open.',
  CONFIG_NOT_FOUND: 'Game setup is incomplete. Please contact support.',
  TIMER_EXPIRED: 'Registration time has ended. The game is about to start!',
  MAX_CARDS: 'You\'ve reached the maximum number of cards for this game.',
  CARD_UNAVAILABLE: 'This card has already been taken. Please select another one.',
  INSUFFICIENT_BALANCE: 'Insufficient balance. Please top up to continue playing.',
  GAME_CHANGED: 'The game state changed. Please try again.',
  GAME_NOT_IN_PROGRESS: 'The game is not currently active.',
  CARD_INVALID: 'This card is no longer valid for play.',
  ALREADY_CALLED: 'Bingo has already been called on this card.',
};

class FB_FastBingoEngine {
  constructor(io) {
    this.io = io;
    this.timers = new Map();
    this.userSockets = new Map();
  }

  // =====================
  // SOCKET MANAGEMENT
  // =====================
  setUserSocket(userId, socketId) {
    this.userSockets.set(userId.toString(), socketId);
  }

  removeUserSocket(userId) {
    this.userSockets.delete(userId.toString());
  }

  getUserSocket(userId) {
    const socketId = this.userSockets.get(userId.toString());
    return socketId ? this.io.sockets.sockets.get(socketId) : null;
  }

  // =====================
  // HELPERS
  // =====================
  getBingoLetter(number) {
    if (number <= 15) return 'B';
    if (number <= 30) return 'I';
    if (number <= 45) return 'N';
    if (number <= 60) return 'G';
    return 'O';
  }

  shuffleNumbers() {
    const numbers = Array.from({ length: 75 }, (_, i) => i + 1);
    for (let i = numbers.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
    }
    return numbers;
  }

  clearTimers(roomId) {
    const gameTimers = this.timers.get(roomId);
    if (gameTimers) {
      Object.values(gameTimers).forEach(timer => clearInterval(timer));
      this.timers.delete(roomId);
    }
  }

  // =====================
  // GAME LIFECYCLE
  // =====================
  async getOrCreateGame(roomId) {
    let game = await Game.getActiveGame(roomId);
    if (!game) {
      const config = await GameConfig.findOne({ roomId });
      if (!config) return null;
      const lastNumber = await Game.getLatestGameNumber(roomId);
      game = await Game.create({
        gameId: String(lastNumber + 1).padStart(10, '0'),
        gameNumber: lastNumber + 1,
        roomId,
        status: 'scheduled',
        allNumbers: this.shuffleNumbers(),
        timerDuration: config.waitTimeSeconds
      });
    }
    return game;
  }

  // =====================
  // CONFIG MANAGEMENT
  // =====================
  async getConfig(roomId) {
    return GameConfig.findOne({ roomId }).lean();
  }

  async updateConfig(roomId, updates) {
    const { _id, __v, createdAt, updatedAt, ...cleanUpdates } = updates;
    const config = await GameConfig.findOneAndUpdate(
      { roomId },
      cleanUpdates,
      { new: true, upsert: true }
    );
    this.io.to(roomId).emit('configUpdated', {
      cardPrice: config.cardPrice,
      maxCardsPerPlayer: config.maxCardsPerPlayer,
      waitTimeSeconds: config.waitTimeSeconds,
      drawIntervalSeconds: config.drawIntervalSeconds,
      commissionPercentage: config.commissionPercentage,
      gracePeriodSeconds: config.gracePeriodSeconds,
      isActive: config.isActive,
      autoBingoEnabled: config.autoBingoEnabled
    });
    return config;
  }

  // =====================
  // WIN DETECTION
  // =====================
  checkWin(card, drawnNumbers) {
    const cols = ['B', 'I', 'N', 'G', 'O'];
    const drawnSet = new Set(drawnNumbers.map(d => d.number));

    for (let r = 0; r < 5; r++) {
      let complete = true;
      for (let c = 0; c < 5; c++) {
        if (cols[c] === 'N' && r === 2) continue;
        if (!drawnSet.has(card.grid[cols[c]][r].number)) { complete = false; break; }
      }
      if (complete) return { type: 'line', cells: cols.map(c => ({ col: c, row: r })) };
    }

    for (let c = 0; c < 5; c++) {
      let complete = true;
      for (let r = 0; r < 5; r++) {
        if (cols[c] === 'N' && r === 2) continue;
        if (!drawnSet.has(card.grid[cols[c]][r].number)) { complete = false; break; }
      }
      if (complete) return { type: 'line', cells: [0,1,2,3,4].map(r => ({ col: cols[c], row: r })) };
    }

    let diag1 = true, diag2 = true;
    const cells1 = [], cells2 = [];
    for (let i = 0; i < 5; i++) {
      if (!(cols[i] === 'N' && i === 2) && !drawnSet.has(card.grid[cols[i]][i].number)) diag1 = false;
      else cells1.push({ col: cols[i], row: i });
      if (!(cols[4-i] === 'N' && i === 2) && !drawnSet.has(card.grid[cols[4-i]][i].number)) diag2 = false;
      else cells2.push({ col: cols[4-i], row: i });
    }
    if (diag1) return { type: 'line', cells: cells1 };
    if (diag2) return { type: 'line', cells: cells2 };

    if (drawnSet.has(card.grid.B[0].number) && drawnSet.has(card.grid.O[0].number) &&
        drawnSet.has(card.grid.B[4].number) && drawnSet.has(card.grid.O[4].number)) {
      return { type: 'four_corners', cells: [{ col:'B',row:0 },{ col:'O',row:0 },{ col:'B',row:4 },{ col:'O',row:4 }] };
    }
    return null;
  }

  // =====================
  // CARD PURCHASE (Atomic)
  // =====================
  async purchaseCard(roomId, userId, cardId) {
    const game = await Game.getActiveGame(roomId);
    if (!game || !['scheduled', 'waiting'].includes(game.status)) {
      throw new Error(ERRORS.GAME_NOT_OPEN);
    }

    const config = await GameConfig.findOne({ roomId });
    if (!config) throw new Error(ERRORS.CONFIG_NOT_FOUND);

    if (game.timerStartedAt && game.timerDuration) {
      const timerEnd = new Date(game.timerStartedAt).getTime() + (game.timerDuration * 1000);
      if (Date.now() >= timerEnd) throw new Error(ERRORS.TIMER_EXPIRED);
    }

    const myCardsCount = await Card.countDocuments({ gameId: game._id, userId, status: 'registered' });
    if (myCardsCount >= config.maxCardsPerPlayer) throw new Error(ERRORS.MAX_CARDS);

    // Atomic card claim
    const card = await Card.findOneAndUpdate(
      { _id: cardId, status: 'available' },
      { $set: { status: 'reserved', reservedAt: new Date(), reservedBy: userId } },
      { new: true }
    );
    if (!card) throw new Error(ERRORS.CARD_UNAVAILABLE);

    // Atomic balance deduction
    const user = await User.findOneAndUpdate(
      { _id: userId, walletBalance: { $gte: config.cardPrice } },
      { $inc: { walletBalance: -config.cardPrice } },
      { new: true }
    );
    if (!user) {
      await Card.findByIdAndUpdate(cardId, { $set: { status: 'available', reservedBy: null, reservedAt: null } });
      throw new Error(ERRORS.INSUFFICIENT_BALANCE);
    }

    // Finalize card
    card.status = 'registered';
    card.userId = userId;
    card.gameId = game._id;
    card.cardNumber = game.totalCards + 1;
    card.price = config.cardPrice;
    card.registeredAt = new Date();
    card.reservedBy = null;
    card.reservedAt = null;
    await card.save();

    // 🔥 Atomic game update — no version conflicts
    const isFirstPlayer = game.players.length === 0;
    const playerIndex = game.players.findIndex(p => p.userId.toString() === userId);

    const gameUpdate = {
      $inc: { totalCards: 1, prizePool: config.cardPrice },
    };

    if (playerIndex === -1) {
      gameUpdate.$push = { players: { userId, cards: [card._id] } };
    } else {
      gameUpdate.$push = { [`players.${playerIndex}.cards`]: card._id };
    }

    if (isFirstPlayer) {
      gameUpdate.$set = {
        timerStartedAt: new Date(),
        timerDuration: config.waitTimeSeconds,
        status: 'waiting',
      };
    }

    const updatedGame = await Game.findOneAndUpdate(
      { _id: game._id, status: { $in: ['scheduled', 'waiting'] } },
      gameUpdate,
      { new: true }
    );

    if (!updatedGame) {
      await Card.findByIdAndUpdate(cardId, { $set: { status: 'available', reservedBy: null, reservedAt: null } });
      await User.findByIdAndUpdate(userId, { $inc: { walletBalance: config.cardPrice } });
      throw new Error(ERRORS.GAME_CHANGED);
    }

    // Create transaction
    await Transaction.create({
      userId, type: 'card_purchase', amount: -config.cardPrice,
      balanceAfter: user.walletBalance, gameId: game.gameId,
      gameNumber: game.gameNumber, description: `Card #${card.cardNumber}`,
      cardId: card._id, status: 'completed'
    });

    // Emit events
    this.io.to(roomId).emit('cardPurchased', {
      userId, cardId: card._id, cardNumber: card.cardNumber,
      displayId: card.displayId, totalCards: updatedGame.totalCards,
      prizePool: updatedGame.prizePool, playerCount: updatedGame.players.length,
      timerStartedAt: updatedGame.timerStartedAt,
      timerDuration: updatedGame.timerDuration,
      card: { _id: card._id, cardNumber: card.cardNumber, displayId: card.displayId, grid: card.grid }
    });

    const buyerSocket = this.getUserSocket(userId);
    if (buyerSocket) {
      buyerSocket.emit('balanceUpdated', { newBalance: user.walletBalance });
    }

    if (isFirstPlayer) {
      this.startCountdown(roomId, updatedGame, config);
    }

    return {
      success: true, cardId: card._id, cardNumber: card.cardNumber,
      newBalance: user.walletBalance, cardsOwned: myCardsCount + 1
    };
  }

  // =====================
  // COUNTDOWN & GAME START
  // =====================
  startCountdown(roomId, game, config) {
    this.clearTimers(roomId);
    const gameTimers = {};
    const durationMs = config.waitTimeSeconds * 1000;
    const startTime = Date.now();

    gameTimers.tick = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, Math.ceil((durationMs - elapsed) / 1000));
      this.io.to(roomId).emit('countdownTick', { remaining, totalDuration: config.waitTimeSeconds });
      if (remaining <= 0) clearInterval(gameTimers.tick);
    }, 1000);

    gameTimers.countdown = setTimeout(async () => {
      clearInterval(gameTimers.tick);
      const current = await Game.findById(game._id);
      if (!current || current.status === 'completed') return;
      const playerCount = current.players.length;
      if (playerCount >= config.minPlayersToStart) {
        await this.startGame(roomId, current, config);
      } else if (playerCount === 0 && config.resetOnNoPlayers) {
        await Game.updateOne({ _id: game._id }, { $set: { timerStartedAt: new Date() } });
        this.io.to(roomId).emit('countdownReset', { timerStartedAt: new Date(), timerDuration: config.waitTimeSeconds });
        this.startCountdown(roomId, current, config);
      } else {
        this.startPlayerPoll(roomId, current, config);
      }
    }, durationMs);

    this.timers.set(roomId, gameTimers);
    this.io.to(roomId).emit('countdownStarted', {
      timerStartedAt: new Date().toISOString(),
      timerDuration: config.waitTimeSeconds,
      gameId: game.gameId || game._id,
      gameNumber: game.gameNumber
    });
  }

  startPlayerPoll(roomId, game, config) {
    const poll = setInterval(async () => {
      const current = await Game.findById(game._id).lean();
      if (!current || current.status === 'completed') { clearInterval(poll); return; }
      const playerCount = current.players.length;
      if (playerCount >= config.minPlayersToStart) {
        clearInterval(poll);
        await this.startGame(roomId, await Game.findById(game._id), config);
      } else if (playerCount === 0 && config.resetOnNoPlayers) {
        clearInterval(poll);
        await Game.updateOne({ _id: game._id }, { $set: { timerStartedAt: new Date() } });
        this.startCountdown(roomId, current, config);
      }
    }, 3000);
    const existing = this.timers.get(roomId) || {};
    existing.poll = poll;
    this.timers.set(roomId, existing);
  }

  async startGame(roomId, game, config) {
    await Game.updateOne({ _id: game._id }, { $set: { status: 'in_progress', startTime: new Date() } });
    this.io.to(roomId).emit('gameStarted', {
      gameId: game.gameId || game._id, gameNumber: game.gameNumber,
      prizePool: game.prizePool, playerCount: game.players.length, totalCards: game.totalCards
    });
    this.drawNumbers(roomId, game, config);
  }

  // =====================
  // NUMBER DRAWING
  // =====================
  drawNumbers(roomId, game, config) {
    const gameId = game._id;
    let drawIndex = 0;

    const drawTimer = setInterval(async () => {
      const current = await Game.findById(gameId).lean();
      if (!current || ['completed', 'grace_period', 'bingo_called'].includes(current.status)) {
        clearInterval(drawTimer); return;
      }
      if (drawIndex >= current.allNumbers.length) {
        clearInterval(drawTimer);
        await this.endGameNoWinner(roomId, current);
        return;
      }
      const number = current.allNumbers[drawIndex];
      const letter = this.getBingoLetter(number);
      await Game.updateOne({ _id: gameId }, {
        $set: { currentNumber: { number, letter } },
        $push: { drawnNumbers: { number, letter, drawnAt: new Date() } }
      });
      this.io.to(roomId).emit('numberDrawn', { number, letter, drawCount: drawIndex + 1, totalNumbers: current.allNumbers.length });
      if (config.autoBingoEnabled && drawIndex >= 4) {
        await this.checkAutoBingo(roomId, gameId, config);
      }
      drawIndex++;
    }, config.drawIntervalSeconds * 1000);

    const existing = this.timers.get(roomId) || {};
    existing.draw = drawTimer;
    this.timers.set(roomId, existing);
  }

  async checkAutoBingo(roomId, gameId, config) {
    const game = await Game.findById(gameId);
    if (!game || game.status !== 'in_progress') return;
    const cards = await Card.find({ gameId, status: 'registered', isBlocked: false, bingoCalled: false }).lean();
    for (const card of cards) {
      const winResult = this.checkWin(card, game.drawnNumbers);
      if (winResult) {
        await Card.updateOne({ _id: card._id }, { $set: { bingoCalled: true, bingoCallTime: new Date(), winType: winResult.type } });
        if (game.status === 'in_progress') {
          await this.handleFirstBingo(roomId, gameId, card, winResult, config);
          return;
        } else {
          this.io.to(roomId).emit('additionalBingo', { userId: card.userId, cardId: card._id, cardNumber: card.cardNumber, winType: winResult.type, autoBingo: true });
        }
      }
    }
  }

  async handleFirstBingo(roomId, gameId, card, winResult, config) {
    this.clearTimers(roomId);
    const graceEndTime = new Date(Date.now() + (config.gracePeriodSeconds || 10) * 1000);
    await Game.updateOne({ _id: gameId }, { $set: { status: 'grace_period', gracePeriodEndTime: graceEndTime } });
    this.io.to(roomId).emit('firstBingo', { userId: card.userId, cardId: card._id, cardNumber: card.cardNumber, winType: winResult.type, cells: winResult.cells, autoBingo: true });
    this.io.to(roomId).emit('gracePeriodStarted', { seconds: config.gracePeriodSeconds || 10, endTime: graceEndTime.toISOString() });
    const graceTimer = setTimeout(() => this.endGracePeriod(roomId, gameId), (config.gracePeriodSeconds || 10) * 1000);
    const existing = this.timers.get(roomId) || {};
    existing.grace = graceTimer;
    this.timers.set(roomId, existing);
  }

  // =====================
  // MANUAL BINGO CALL
  // =====================
  async callBingo(roomId, userId, cardId) {
    const game = await Game.getActiveGame(roomId);
    if (!game || !['in_progress', 'bingo_called', 'grace_period'].includes(game.status)) {
      throw new Error(ERRORS.GAME_NOT_IN_PROGRESS);
    }
    const card = await Card.findOne({ _id: cardId, userId, status: 'registered' });
    if (!card || card.isBlocked) throw new Error(ERRORS.CARD_INVALID);
    if (card.bingoCalled) throw new Error(ERRORS.ALREADY_CALLED);

    const config = await GameConfig.findOne({ roomId }).lean();
    const winResult = this.checkWin(card, game.drawnNumbers);
    if (!winResult) {
      await Card.updateOne({ _id: cardId }, { $set: { isBlocked: true, blockReason: 'no_win' } });
      this.io.to(roomId).emit('falseBingo', { userId, cardId, cardNumber: card.cardNumber, reason: 'No winning pattern' });
      return { success: false, reason: 'no_win' };
    }
    await Card.updateOne({ _id: cardId }, { $set: { bingoCalled: true, bingoCallTime: new Date(), winType: winResult.type } });
    if (game.status === 'in_progress') {
      await this.handleFirstBingo(roomId, game._id, card, winResult, config);
    } else {
      this.io.to(roomId).emit('additionalBingo', { userId, cardId, cardNumber: card.cardNumber, winType: winResult.type });
    }
    return { success: true, winType: winResult.type, cells: winResult.cells };
  }

  // =====================
  // GRACE PERIOD END
  // =====================
  async endGracePeriod(roomId, gameId) {
    const game = await Game.findById(gameId);
    if (!game || game.status === 'completed') return;

    const config = await GameConfig.findOne({ roomId }).lean();
    const calledCards = await Card.find({ gameId: game._id, bingoCalled: true, isBlocked: false }).lean();

    const winners = [];
    for (const card of calledCards) {
      const winResult = this.checkWin(card, game.drawnNumbers);
      if (winResult) {
        winners.push({ card, winType: winResult.type });
        await Card.updateOne({ _id: card._id }, { $set: { bingoValidated: true } });
      }
    }

    if (winners.length > 0) {
      const commissionRate = config?.commissionPercentage || 10;
      const commission = (game.prizePool * commissionRate) / 100;
      const prizePerWinner = (game.prizePool - commission) / winners.length;

      const winnerEntries = [];
      for (const { card, winType } of winners) {
        const user = await User.findByIdAndUpdate(card.userId, { $inc: { walletBalance: prizePerWinner } }, { new: true });
        await Transaction.create({ userId: user._id, type: 'prize_win', amount: prizePerWinner, balanceAfter: user.walletBalance, gameId: game.gameId, gameNumber: game.gameNumber, description: `Won with ${winType}` });

        const winnerSocket = this.getUserSocket(user._id);
        if (winnerSocket) winnerSocket.emit('balanceUpdated', { newBalance: user.walletBalance });

        winnerEntries.push({
          userId: user._id, cardId: card._id, winType, prizeAmount: prizePerWinner,
          winnerName: user.fullName, winnerPhone: user.phone, cardNumber: card.cardNumber,
          cardGrid: markGridWithDrawn(card.grid, game.drawnNumbers),
          newBalance: user.walletBalance
        });
      }

      await Transaction.create({ userId: winners[0].card.userId, type: 'commission', amount: commission, gameId: game.gameId, gameNumber: game.gameNumber, description: 'Game commission' });
      await Game.updateOne({ _id: gameId }, { $set: { winners: winnerEntries, commission, status: 'completed', endTime: new Date() } });

      this.io.to(roomId).emit('gameEnded', {
        gameId: game._id, winners: winnerEntries, prizePool: game.prizePool, commission,
        balances: winnerEntries.map(w => ({ userId: w.userId.toString(), balance: w.newBalance }))
      });
    } else {
      await this.endGameNoWinner(roomId, game);
    }

    await this.resetAllCards(roomId);
    this.clearTimers(roomId);
    this.scheduleNewGame(roomId);
  }

  // =====================
  // GAME END - NO WINNER
  // =====================
  async endGameNoWinner(roomId, game) {
    const cards = await Card.find({ gameId: game._id, status: 'registered' }).lean();
    for (const card of cards) {
      const user = await User.findById(card.userId);
      if (user) {
        await User.updateOne({ _id: user._id }, { $inc: { walletBalance: card.price } });
        await Transaction.create({ userId: user._id, type: 'refund', amount: card.price, balanceAfter: user.walletBalance + card.price, gameId: game.gameId, gameNumber: game.gameNumber, description: 'Refund - no winner' });
      }
    }
    await Game.updateOne({ _id: game._id }, { $set: { status: 'completed', endTime: new Date(), endReason: 'no_winner' } });
    this.io.to(roomId).emit('gameEnded', { gameId: game._id, winners: [], prizePool: game.prizePool, reason: 'No winner', refunded: true });
    await this.resetAllCards(roomId);
    this.clearTimers(roomId);
    this.scheduleNewGame(roomId);
  }

  // =====================
  // RESET & NEW GAME
  // =====================
  async resetAllCards(roomId) {
    await Card.updateMany(
      { displayId: { $gte: 10001, $lte: 10400 } },
      { $set: { status: 'available', userId: null, gameId: null, isBlocked: false, bingoCalled: false, winType: null } }
    );
  }

  async scheduleNewGame(roomId) {
    setTimeout(async () => {
      const config = await GameConfig.findOne({ roomId });
      if (!config || !config.isActive) return;
      const lastNumber = await Game.getLatestGameNumber(roomId);
      const newGame = await Game.create({
        gameId: String(lastNumber + 1).padStart(10, '0'),
        gameNumber: lastNumber + 1, roomId, status: 'scheduled',
        allNumbers: this.shuffleNumbers(), timerDuration: config.waitTimeSeconds
      });
      this.io.to(roomId).emit('newGameCreated', { gameId: newGame.gameId, gameNumber: newGame.gameNumber });
    }, 2000);
  }

  // =====================
  // GET GAME STATE
  // =====================
  async getGameState(roomId, userId) {
    const game = await Game.getActiveGame(roomId);
    if (!game) return null;

    const config = await GameConfig.findOne({ roomId }).lean();
    const myCards = userId ? await Card.find({ gameId: game._id, userId, status: 'registered' }).lean() : [];
    const user = userId ? await User.findById(userId).select('walletBalance').lean() : null;
    const soldCards = await Card.find({ gameId: game._id, status: { $in: ['registered', 'sold'] } }).select('_id').lean();

    return {
      gameId: game.gameId, gameNumber: game.gameNumber, status: game.status,
      playerCount: game.players.length, totalCards: game.totalCards, prizePool: game.prizePool,
      currentNumber: game.currentNumber, drawnNumbers: game.drawnNumbers || [],
      timerStartedAt: game.timerStartedAt, timerDuration: game.timerDuration,
      gracePeriodEndTime: game.gracePeriodEndTime,
      config: config ? {
        cardPrice: config.cardPrice, maxCardsPerPlayer: config.maxCardsPerPlayer,
        minPlayersToStart: config.minPlayersToStart, waitTimeSeconds: config.waitTimeSeconds,
        drawIntervalSeconds: config.drawIntervalSeconds, commissionPercentage: config.commissionPercentage,
        gracePeriodSeconds: config.gracePeriodSeconds, autoBingoEnabled: config.autoBingoEnabled
      } : null,
      myCards, soldCardIds: soldCards.map(c => c._id.toString()),
      winners: game.winners || [], balance: user?.walletBalance || 0
    };
  }
}

module.exports = FB_FastBingoEngine;