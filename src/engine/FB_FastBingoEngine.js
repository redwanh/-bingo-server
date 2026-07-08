// ============================================================
// server/src/engine/FB_FastBingoEngine.js
// Fast Bingo Game Engine - Single file, all logic
// ============================================================

const Game = require('../models/FB_Game');
const Card = require('../models/FB_Card');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const GameConfig = require('../models/GameConfig');
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

class FB_FastBingoEngine {
  constructor(io) {
    this.io = io;
    this.timers = new Map();        // gameId → { draw, grace, countdown, tick, poll }
    this.userSockets = new Map();   // userId → socketId
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

  generateCardGrid() {
    const ranges = { B: [1,15], I: [16,30], N: [31,45], G: [46,60], O: [61,75] };
    const grid = {};
    for (const [col, [min, max]] of Object.entries(ranges)) {
      const set = new Set();
      while (set.size < 5) {
        set.add(Math.floor(Math.random() * (max - min + 1)) + min);
      }
      grid[col] = Array.from(set).map(n => ({ number: n, isMarked: false }));
    }
    grid.N[2] = { number: 0, isMarked: true }; // FREE space
    return grid;
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
    const config = await GameConfig.findOneAndUpdate(
      { roomId },
      updates,
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

    // Check rows (5)
    for (let r = 0; r < 5; r++) {
      let complete = true;
      for (let c = 0; c < 5; c++) {
        if (cols[c] === 'N' && r === 2) continue; // skip FREE
        if (!drawnSet.has(card.grid[cols[c]][r].number)) {
          complete = false;
          break;
        }
      }
      if (complete) return { type: 'line', cells: cols.map(c => ({ col: c, row: r })) };
    }

    // Check columns (5)
    for (let c = 0; c < 5; c++) {
      let complete = true;
      for (let r = 0; r < 5; r++) {
        if (cols[c] === 'N' && r === 2) continue;
        if (!drawnSet.has(card.grid[cols[c]][r].number)) {
          complete = false;
          break;
        }
      }
      if (complete) return { type: 'line', cells: [0,1,2,3,4].map(r => ({ col: cols[c], row: r })) };
    }

    // Check diagonals (2)
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

    // Check four corners
    if (drawnSet.has(card.grid.B[0].number) &&
        drawnSet.has(card.grid.O[0].number) &&
        drawnSet.has(card.grid.B[4].number) &&
        drawnSet.has(card.grid.O[4].number)) {
      return {
        type: 'four_corners',
        cells: [
          { col: 'B', row: 0 },
          { col: 'O', row: 0 },
          { col: 'B', row: 4 },
          { col: 'O', row: 4 }
        ]
      };
    }

    return null;
  }

  // =====================
  // CARD PURCHASE
  // =====================

// ============================================================
// CARD PURCHASE (with debug logs)
// ============================================================

async purchaseCard(roomId, userId, cardId) {
  console.log('🎯 purchaseCard called:', { roomId, userId, cardId });
  
  const game = await Game.getActiveGame(roomId);
  console.log('🎯 game:', game ? `#${game.gameNumber} ${game.status}` : 'NULL');
  
  if (!game || !['scheduled', 'waiting'].includes(game.status)) {
    console.log('❌ FAIL: Game not accepting. Status:', game?.status);
    throw new Error('Game not accepting purchases');
  }

  const config = await GameConfig.findOne({ roomId });
  console.log('🎯 config:', config ? `price=${config.cardPrice} maxCards=${config.maxCardsPerPlayer}` : 'NULL');
  if (!config) {
    console.log('❌ FAIL: No config found');
    throw new Error('Configuration not found');
  }

  // Check timer
  if (game.timerStartedAt && game.timerDuration) {
    const timerEnd = new Date(game.timerStartedAt).getTime() + (game.timerDuration * 1000);
    const expired = Date.now() >= timerEnd;
    console.log('🎯 Timer check:', { now: Date.now(), timerEnd, expired });
    if (expired) {
      console.log('❌ FAIL: Timer expired');
      throw new Error('Registration time ended');
    }
  }

  // Check max cards
  const myCardsCount = await Card.countDocuments({
    gameId: game._id, userId, status: 'registered'
  });
  console.log('🎯 myCardsCount:', myCardsCount, '/ max:', config.maxCardsPerPlayer);
  if (myCardsCount >= config.maxCardsPerPlayer) {
    console.log('❌ FAIL: Max cards reached');
    throw new Error(`Maximum ${config.maxCardsPerPlayer} cards allowed`);
  }

  // Atomic card claim
  console.log('🎯 Atomic claim - looking for card:', cardId, 'status: available');
  const card = await Card.findOneAndUpdate(
    { _id: cardId, status: 'available' },
    { $set: { status: 'reserved', reservedAt: new Date(), reservedBy: userId } },
    { new: true }
  );
  
  if (!card) {
    // Check why it failed
    const existingCard = await Card.findById(cardId);
    console.log('❌ FAIL: Card not available. Existing card:', existingCard ? `status=${existingCard.status} gameId=${existingCard.gameId} userId=${existingCard.userId}` : 'NOT FOUND');
    throw new Error('Card no longer available');
  }
  console.log('✅ Card claimed:', card._id, 'status:', card.status);

  // Atomic balance deduction
  console.log('🎯 Deducting balance:', config.cardPrice, 'from user:', userId);
  const user = await User.findOneAndUpdate(
    { _id: userId, walletBalance: { $gte: config.cardPrice } },
    { $inc: { walletBalance: -config.cardPrice } },
    { new: true }
  );
  
  if (!user) {
    console.log('❌ FAIL: Insufficient balance. Rolling back card...');
    await Card.findByIdAndUpdate(cardId, { $set: { status: 'available', reservedBy: null, reservedAt: null } });
    throw new Error(`Insufficient balance. Need ${config.cardPrice} ETB`);
  }
  console.log('✅ Balance deducted. New balance:', user.walletBalance);

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
  console.log('✅ Card finalized:', { id: card._id, status: card.status, gameId: card.gameId, userId: card.userId, cardNumber: card.cardNumber });

  // Update game
  const isFirstPlayer = game.players.length === 0;
  const playerIndex = game.players.findIndex(p => p.userId.toString() === userId);

  if (playerIndex === -1) {
    game.players.push({ userId, cards: [card._id] });
  } else {
    game.players[playerIndex].cards.push(card._id);
  }

  game.totalCards += 1;
  game.prizePool += config.cardPrice;

  if (isFirstPlayer) {
    game.timerStartedAt = new Date();
    game.timerDuration = config.waitTimeSeconds;
    game.status = 'waiting';
  }

  await game.save();
  console.log('✅ Game updated:', { totalCards: game.totalCards, prizePool: game.prizePool, players: game.players.length, status: game.status, isFirstPlayer });

  // Create transaction
  await Transaction.create({
    userId,
    type: 'card_purchase',
    amount: -config.cardPrice,
    balanceAfter: user.walletBalance,
    gameId: game.gameId,
    gameNumber: game.gameNumber,
    description: `Card #${card.cardNumber}`,
    cardId: card._id,
    status: 'completed'
  });
  console.log('✅ Transaction created');

  // Emit events
  this.io.to(roomId).emit('cardPurchased', {
    userId,
    cardId: card._id,
    cardNumber: card.cardNumber,
    displayId: card.displayId,
    totalCards: game.totalCards,
    prizePool: game.prizePool,
    playerCount: game.players.length,
    timerStartedAt: game.timerStartedAt,
    timerDuration: game.timerDuration,
    card: { _id: card._id, cardNumber: card.cardNumber, displayId: card.displayId, grid: card.grid }
  });
  console.log('✅ cardPurchased emitted to room:', roomId);

  // Emit balance update to buyer
  const buyerSocket = this.getUserSocket(userId);
  if (buyerSocket) {
    buyerSocket.emit('balanceUpdated', { newBalance: user.walletBalance });
    console.log('✅ balanceUpdated emitted to user:', userId);
  }

  // Start countdown on first purchase
  if (isFirstPlayer) {
    console.log('🎯 First player! Starting countdown...');
    this.startCountdown(roomId, game, config);
  }

  console.log('✅ purchaseCard COMPLETE');
  
  return {
    success: true,
    cardId: card._id,
    cardNumber: card.cardNumber,
    newBalance: user.walletBalance,
    cardsOwned: myCardsCount + 1
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

    // Tick every second
    gameTimers.tick = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, Math.ceil((durationMs - elapsed) / 1000));
      this.io.to(roomId).emit('countdownTick', { remaining, totalDuration: config.waitTimeSeconds });
      if (remaining <= 0) clearInterval(gameTimers.tick);
    }, 1000);

    // Countdown end
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
      if (!current || current.status === 'completed') {
        clearInterval(poll);
        return;
      }
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
    await Game.updateOne(
      { _id: game._id },
      { $set: { status: 'in_progress', startTime: new Date() } }
    );

    this.io.to(roomId).emit('gameStarted', {
      gameId: game.gameId || game._id,
      gameNumber: game.gameNumber,
      prizePool: game.prizePool,
      playerCount: game.players.length,
      totalCards: game.totalCards
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
      // Refresh game state periodically
      const current = await Game.findById(gameId).lean();
      if (!current || ['completed', 'grace_period', 'bingo_called'].includes(current.status)) {
        clearInterval(drawTimer);
        return;
      }

      if (drawIndex >= current.allNumbers.length) {
        clearInterval(drawTimer);
        await this.endGameNoWinner(roomId, current);
        return;
      }

      const number = current.allNumbers[drawIndex];
      const letter = this.getBingoLetter(number);

      // Update game
      await Game.updateOne(
        { _id: gameId },
        {
          $set: { currentNumber: { number, letter } },
          $push: { drawnNumbers: { number, letter, drawnAt: new Date() } }
        }
      );

      // Emit to room
      this.io.to(roomId).emit('numberDrawn', {
        number,
        letter,
        drawCount: drawIndex + 1,
        totalNumbers: current.allNumbers.length
      });

      // Check auto-bingo
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

    const cards = await Card.find({
      gameId,
      status: 'registered',
      isBlocked: false,
      bingoCalled: false
    }).lean();

    for (const card of cards) {
      const winResult = this.checkWin(card, game.drawnNumbers);
      if (winResult) {
        await Card.updateOne(
          { _id: card._id },
          { $set: { bingoCalled: true, bingoCallTime: new Date(), winType: winResult.type } }
        );

        if (game.status === 'in_progress') {
          // First bingo
          await this.handleFirstBingo(roomId, gameId, card, winResult, config);
          return;
        } else {
          // Additional bingo
          this.io.to(roomId).emit('additionalBingo', {
            userId: card.userId,
            cardId: card._id,
            cardNumber: card.cardNumber,
            winType: winResult.type,
            autoBingo: true
          });
        }
      }
    }
  }

  async handleFirstBingo(roomId, gameId, card, winResult, config) {
    this.clearTimers(roomId);

    const graceEndTime = new Date(Date.now() + (config.gracePeriodSeconds || 10) * 1000);
    await Game.updateOne(
      { _id: gameId },
      { $set: { status: 'grace_period', gracePeriodEndTime: graceEndTime } }
    );

    this.io.to(roomId).emit('firstBingo', {
      userId: card.userId,
      cardId: card._id,
      cardNumber: card.cardNumber,
      winType: winResult.type,
      cells: winResult.cells,
      autoBingo: true
    });

    this.io.to(roomId).emit('gracePeriodStarted', {
      seconds: config.gracePeriodSeconds || 10,
      endTime: graceEndTime.toISOString()
    });

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
      throw new Error('Game not in progress');
    }

    const card = await Card.findOne({ _id: cardId, userId, status: 'registered' });
    if (!card || card.isBlocked) throw new Error('Card not valid');
    if (card.bingoCalled) throw new Error('Bingo already called on this card');

    const config = await GameConfig.findOne({ roomId }).lean();

    // Check win
    const winResult = this.checkWin(card, game.drawnNumbers);
    if (!winResult) {
      // False bingo
      await Card.updateOne({ _id: cardId }, { $set: { isBlocked: true, blockReason: 'no_win' } });
      this.io.to(roomId).emit('falseBingo', {
        userId, cardId, cardNumber: card.cardNumber, reason: 'No winning pattern'
      });
      return { success: false, reason: 'no_win' };
    }

    // Valid bingo
    await Card.updateOne(
      { _id: cardId },
      { $set: { bingoCalled: true, bingoCallTime: new Date(), winType: winResult.type } }
    );

    if (game.status === 'in_progress') {
      await this.handleFirstBingo(roomId, game._id, card, winResult, config);
    } else {
      this.io.to(roomId).emit('additionalBingo', {
        userId, cardId, cardNumber: card.cardNumber, winType: winResult.type
      });
    }

    return { success: true, winType: winResult.type, cells: winResult.cells };
  }

  // =====================
  // GRACE PERIOD END - PRIZE DISTRIBUTION
  // =====================

  async endGracePeriod(roomId, gameId) {
    const game = await Game.findById(gameId);
    if (!game || game.status === 'completed') return;

    const config = await GameConfig.findOne({ roomId }).lean();
    const calledCards = await Card.find({
      gameId: game._id,
      bingoCalled: true,
      isBlocked: false
    }).lean();

    // Re-validate all called cards
    const winners = [];
    for (const card of calledCards) {
      const winResult = this.checkWin(card, game.drawnNumbers);
      if (winResult) {
        winners.push({ card, winType: winResult.type });
        await Card.updateOne({ _id: card._id }, { $set: { bingoValidated: true } });
      }
    }

    if (winners.length > 0) {
      // Calculate prizes
      const commissionRate = config?.commissionPercentage || 10;
      const commission = (game.prizePool * commissionRate) / 100;
      const prizePerWinner = (game.prizePool - commission) / winners.length;

      // Distribute prizes
      const winnerEntries = [];
      for (const { card, winType } of winners) {
        const user = await User.findByIdAndUpdate(
          card.userId,
          { $inc: { walletBalance: prizePerWinner } },
          { new: true }
        );

        await Transaction.create({
          userId: user._id,
          type: 'prize_win',
          amount: prizePerWinner,
          balanceAfter: user.walletBalance,
          gameId: game.gameId,
          gameNumber: game.gameNumber,
          description: `Won with ${winType}`
        });

        // Emit balance update to winner
        const winnerSocket = this.getUserSocket(user._id);
        if (winnerSocket) {
          winnerSocket.emit('balanceUpdated', { newBalance: user.walletBalance });
        }

        winnerEntries.push({
          userId: user._id,
          cardId: card._id,
          winType,
          prizeAmount: prizePerWinner,
          winnerName: user.fullName,
          winnerPhone: user.phone,
          cardNumber: card.cardNumber,
           cardGrid: markGridWithDrawn(card.grid, game.drawnNumbers),
          newBalance: user.walletBalance
        });
      }

      // Record commission
      await Transaction.create({
        userId: winners[0].card.userId,
        type: 'commission',
        amount: commission,
        gameId: game.gameId,
        gameNumber: game.gameNumber,
        description: 'Game commission'
      });

      await Game.updateOne(
        { _id: gameId },
        { $set: { winners: winnerEntries, commission, status: 'completed', endTime: new Date() } }
      );

      // Broadcast game ended
      this.io.to(roomId).emit('gameEnded', {
        gameId: game._id,
        winners: winnerEntries,
        prizePool: game.prizePool,
        commission,
         balances: winnerEntries.map(w => ({ userId: w.userId.toString(), balance: w.newBalance }))
      });
    } else {
      // No winners - refund all
      await this.endGameNoWinner(roomId, game);
    }

    // Cleanup and schedule next game
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
        await Transaction.create({
          userId: user._id,
          type: 'refund',
          amount: card.price,
          balanceAfter: user.walletBalance + card.price,
          gameId: game.gameId,
          gameNumber: game.gameNumber,
          description: 'Refund - no winner'
        });
      }
    }

    await Game.updateOne(
      { _id: game._id },
      { $set: { status: 'completed', endTime: new Date(), endReason: 'no_winner' } }
    );

    this.io.to(roomId).emit('gameEnded', {
      gameId: game._id,
      winners: [],
      prizePool: game.prizePool,
      reason: 'No winner',
      refunded: true
    });

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
        gameNumber: lastNumber + 1,
        roomId,
        status: 'scheduled',
        allNumbers: this.shuffleNumbers(),
        timerDuration: config.waitTimeSeconds
      });

      this.io.to(roomId).emit('newGameCreated', {
        gameId: newGame.gameId,
        gameNumber: newGame.gameNumber
      });
    }, 2000);
  }

  // =====================
  // GET GAME STATE
  // =====================

  async getGameState(roomId, userId) {
    const game = await Game.getActiveGame(roomId);
     console.log('🔍 getGameState: game found:', !!game, 'status:', game?.status);
    if (!game) return null;

    const config = await GameConfig.findOne({ roomId }).lean();
    const myCards = userId
      ? await Card.find({ gameId: game._id, userId, status: 'registered' }).lean()
      : [];
       console.log('🔍 getGameState: myCards count:', myCards.length);
    const user = userId
      ? await User.findById(userId).select('walletBalance').lean()
      : null;

    const soldCards = await Card.find({
      gameId: game._id,
      status: { $in: ['registered', 'sold'] }
    }).select('_id').lean();

    return {
      gameId: game.gameId,
      gameNumber: game.gameNumber,
      status: game.status,
      playerCount: game.players.length,
      totalCards: game.totalCards,
      prizePool: game.prizePool,
      currentNumber: game.currentNumber,
      drawnNumbers: game.drawnNumbers || [],
      timerStartedAt: game.timerStartedAt,
      timerDuration: game.timerDuration,
      gracePeriodEndTime: game.gracePeriodEndTime,
      config: config ? {
        cardPrice: config.cardPrice,
        maxCardsPerPlayer: config.maxCardsPerPlayer,
        minPlayersToStart: config.minPlayersToStart,
        waitTimeSeconds: config.waitTimeSeconds,
        drawIntervalSeconds: config.drawIntervalSeconds,
        commissionPercentage: config.commissionPercentage,
        gracePeriodSeconds: config.gracePeriodSeconds,
        autoBingoEnabled: config.autoBingoEnabled
      } : null,
      myCards,
      soldCardIds: soldCards.map(c => c._id.toString()),
      winners: game.winners || [],
      balance: user?.walletBalance || 0
    };
  }
}

module.exports = FB_FastBingoEngine;