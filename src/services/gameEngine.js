const Game = require("../models/Game");
const GameConfig = require("../models/GameConfig");
const Card = require("../models/Card");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Notification = require("../models/Notification");
const timerManager = require("../utils/TimerManager");

// ============================================
// 🔍 DEBUG HELPERS
// Set DEBUG to false to disable all debug logs
// ============================================
const DEBUG = true;
const log = (...args) => DEBUG && console.log(...args);
const logError = (...args) => console.error(...args);
const divider = () => DEBUG && console.log("═".repeat(60));

/**
 * GameEngine - Core game logic for Bingo game
 * Handles: card management, number drawing, win checking, refunds, crash recovery
 *
 * MAINTENANCE NOTES:
 * - checkWin() now requires 4 parameters: (card, drawnNumbers, config, rule)
 * - Always pass config.winRule as the 4th parameter when calling checkWin()
 * - config.winRule contains the win conditions (method, patterns, line requirements)
 * - Timer keys format: draw_${roomId}, countdown_${roomId}, poll_${roomId}, grace_${roomId}
 */
class GameEngine {
  constructor(io) {
    this.io = io;
    this.userSockets = new Map(); // userId → socketId mapping
    this.games = new Map(); // roomId → game object mapping
    this.activeGames = new Set(); // Set of active game IDs
    log("🎮 GameEngine initialized");
  }

  // ============================================
  // SOCKET MANAGEMENT
  // ============================================
  setUserSocket(userId, socketId) {
    this.userSockets.set(userId.toString(), socketId);
    log(`🔌 User socket set: ${userId} → ${socketId}`);
  }

  removeUserSocket(userId) {
    this.userSockets.delete(userId.toString());
    log(`🔌 User socket removed: ${userId}`);
  }

  getUserSocket(userId) {
    const socketId = this.userSockets.get(userId.toString());
    if (socketId) return this.io.sockets.sockets.get(socketId);
    return null;
  }

  cleanup() {
    log("🧹 GameEngine cleanup");
    timerManager.reportStats();
  }

  /**
   * Safely get player count from a game object
   * @param {Object} game - Game document
   * @returns {number} Player count
   */
  getPlayerCount(game) {
    if (!game) return 0;
    if (!game.players) return 0;
    if (!Array.isArray(game.players)) return 0;
    return game.players.length;
  }

  // ============================================
  // NOTIFICATIONS
  // ============================================
  /**
   * Send a notification to a user (saves to DB and emits via socket)
   * @param {string} userId - User ID
   * @param {Object} data - Notification data (type, title, message, etc.)
   * @returns {Object|null} Created notification or null
   */
  async sendNotification(userId, data) {
    try {
      log(`📧 Sending notification to ${userId}: ${data.title}`);
      const notification = await Notification.create({
        user: userId,
        type: data.type || "system",
        title: data.title,
        titleAm: data.titleAm,
        titleTg: data.titleTg,
        message: data.message,
        messageAm: data.messageAm,
        messageTg: data.messageTg,
        priority: data.priority || "normal",
        amount: data.amount,
        expiresAt:
          data.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
      const socket = this.getUserSocket(userId);
      if (socket) {
        socket.emit("newNotification", notification);
        log(`📧 Notification sent to socket`);
      } else {
        log(`📧 User ${userId} not connected, notification saved to DB`);
      }
      return notification;
    } catch (e) {
      logError(`❌ Failed to send notification: ${e.message}`);
      return null;
    }
  }

  /**
   * Send refund notification to a user
   * @param {string} uid - User ID
   * @param {number} amt - Refund amount
   * @param {number} gn - Game number
   * @param {string} reason - Reason for refund
   */
  async sendRefundNotification(uid, amt, gn, reason) {
    log(`💸 Sending refund notification to ${uid}: ${amt} ETB for Game #${gn}`);
    return this.sendNotification(uid, {
      type: "refund",
      title: "Refund Processed",
      titleAm: "ተመላሽ ገንዘብ ተከፍሏል",
      titleTg: "ገንዘብ ተመላሽ ተደርጓል",
      message: `Your ${amt} ETB refunded for Game #${gn}. ${reason}`,
      messageAm: `${amt} ብር ለጨዋታ #${gn} ተመላሽ ተደርጓል።`,
      messageTg: `ናይ ${amt} ብር ንጸወታ #${gn} ተመሊሱ።`,
      priority: "high",
      amount: amt,
    });
  }

  /**
   * Send game cancelled notification
   * @param {string} uid - User ID
   * @param {number} gn - Game number
   */
  async sendGameCancelledNotification(uid, gn) {
    log(`🚫 Sending game cancelled notification to ${uid}: Game #${gn}`);
    return this.sendNotification(uid, {
      type: "game_cancelled",
      title: "Game Cancelled",
      titleAm: "ጨዋታ ተሰርዟል",
      titleTg: "ጸወታ ተሰሪዙ",
      message: `Game #${gn} interrupted. Cards refunded.`,
      messageAm: `ጨዋታ #${gn} ተቋርጧል።`,
      messageTg: `ጸወታ #${gn} ተቋሪጹ።`,
      priority: "high",
    });
  }

  /**
   * Send winning notification to a user
   * @param {string} uid - User ID
   * @param {number} amt - Win amount
   * @param {number} gn - Game number
   * @param {string} wt - Win type
   */
  async sendWinningNotification(uid, amt, gn, wt) {
    log(
      `🏆 Sending winning notification to ${uid}: ${amt} ETB for Game #${gn} (${wt})`,
    );
    return this.sendNotification(uid, {
      type: "winning",
      title: "You Won!",
      titleAm: "አሸንፈዋል!",
      titleTg: "ተዓዊትኩም!",
      message: `You won ${amt} ETB in Game #${gn} (${wt})!`,
      messageAm: `${amt} ብር አሸንፈዋል (${wt})!`,
      messageTg: `${amt} ብር ተዓዊትኩም (${wt})!`,
      priority: "high",
      amount: amt,
    });
  }

  // ============================================
  // REFUND LOGIC
  // ============================================
  /**
   * Refund all cards in a game
   * @param {string} gameId - Game MongoDB ID
   * @param {string} reason - Reason for refund
   * @returns {Object} Refund statistics
   */
  async refundGame(gameId, reason = "server_interruption") {
    divider();
    log(`💸 REFUND GAME STARTED: ${gameId} - Reason: ${reason}`);

    const game = await Game.findById(gameId);
    if (!game) {
      logError(`❌ Game not found: ${gameId}`);
      throw new Error("Game not found");
    }

    log(
      `📊 Game #${game.gameNumber} - Status: ${game.status}, Prize Pool: ${game.prizePool}`,
    );

    const cards = await Card.find({ gameId: game._id, status: "registered" });
    log(`📊 Found ${cards.length} registered cards to refund`);

    const stats = {
      totalCards: cards.length,
      totalAmount: 0,
      successfulRefunds: 0,
      failedRefunds: 0,
      refundedUsers: new Set(),
    };

    for (const card of cards) {
      try {
        await this.refundSingleCard(card, game, reason, stats);
      } catch (e) {
        logError(`❌ Failed to refund card ${card._id}: ${e.message}`);
        stats.failedRefunds++;
      }
    }

    game.status = "completed";
    game.endTime = new Date();
    game.endReason = reason;
    game.refundStats = {
      totalRefunded: stats.totalAmount,
      cardsRefunded: stats.successfulRefunds,
      usersRefunded: stats.refundedUsers.size,
    };
    await game.save();

    log(`💸 REFUND COMPLETE:`);
    log(`   Total amount: ${stats.totalAmount} ETB`);
    log(`   Successful: ${stats.successfulRefunds}`);
    log(`   Failed: ${stats.failedRefunds}`);
    log(`   Users refunded: ${stats.refundedUsers.size}`);
    divider();

    return stats;
  }

  /**
   * Refund a single card to its owner
   * @param {Object} card - Card document
   * @param {Object} game - Game document
   * @param {string} reason - Refund reason
   * @param {Object} stats - Running stats object to update
   */
  async refundSingleCard(card, game, reason, stats) {
    const user = await User.findById(card.userId);
    if (!user) {
      log(`⚠️ User not found for card ${card._id}`);
      return;
    }

    const amt = card.price || 0;
    const oldBalance = user.walletBalance;
    user.walletBalance += amt;
    await user.save();

    log(
      `💰 Refunded ${amt} ETB to ${user.fullName || user._id} (${oldBalance} → ${user.walletBalance})`,
    );

    await Transaction.create({
      userId: user._id,
      type: "refund",
      amount: amt,
      gameId: game.gameId,
      gameNumber: game.gameNumber,
      description: `Refund Game #${game.gameNumber}`,
      balanceAfter: user.walletBalance,
      cardId: card._id,
    });

    await this.sendRefundNotification(user._id, amt, game.gameNumber, reason);

    stats.totalAmount += amt;
    stats.successfulRefunds++;
    stats.refundedUsers.add(user._id.toString());
  }

  // ============================================
  // CRASH RECOVERY
  // ============================================
  /**
   * Recover from server crash - find stuck games and decide to refund or resume
   */
  async recoverFromCrash() {
    divider();
    log("🔄 CRASH RECOVERY STARTED");

    const stuckGames = await Game.find({
      status: { $in: ["in_progress", "bingo_called", "waiting", "scheduled"] },
      updatedAt: { $lt: new Date(Date.now() - 30000) },
    });

    log(`📊 Found ${stuckGames.length} stuck games`);

    for (const game of stuckGames) {
      await this.decideAndRecover(game);
    }

    log("✅ Crash recovery complete");
    divider();
  }

  /**
   * Decide whether to refund or resume a stuck game
   * @param {Object} game - Game document
   */
  async decideAndRecover(game) {
    const pc = this.getPlayerCount(game);
    log(
      `\n🔍 Analyzing Game #${game.gameNumber} - Status: ${game.status}, Players: ${pc}, Last updated: ${game.updatedAt}`,
    );

    if (await this.shouldRefundGame(game)) {
      log(`→ Decision: REFUND`);
      await this.refundAndRestart(game);
    } else {
      log(`→ Decision: RECOVER`);
      await this.recoverAndResume(game);
    }
  }

  /**
   * Determine if a game should be refunded based on inactivity and state
   * @param {Object} game - Game document
   * @returns {boolean} True if game should be refunded
   */
  async shouldRefundGame(game) {
    const config = await GameConfig.findOne({ roomId: game.roomId });

    if (game.status === "waiting" || game.status === "scheduled") {
      if (config && game.timerStartedAt) {
        const elapsed = (Date.now() - game.timerStartedAt.getTime()) / 1000;
        const maxWait = Math.max(config.waitTimeSeconds * 3, 120);
        log(`   Elapsed: ${elapsed}s, Max wait: ${maxWait}s`);
        if (elapsed > maxWait) return true;
      }
      return false;
    }

    const inactiveTime = (Date.now() - game.updatedAt) / 1000;
    log(`   Inactive for: ${inactiveTime}s`);

    if (inactiveTime > 600) return true;
    if (game.drawnNumbers && game.drawnNumbers.length < 5) return true;

    return false;
  }

  async refundAndRestart(game) {
    log(`🔄 Refunding and restarting Game #${game.gameNumber}`);
    const stats = await this.refundGame(game._id, "server_interruption");
    this.io
      .to(game.roomId)
      .emit("gameCancelled", { gameNumber: game.gameNumber });
    await this.createNewGameAfterDelay(game.roomId, 3000);
  }

  async recoverAndResume(game) {
    const config = await GameConfig.findOne({ roomId: game.roomId });
    if (!config) {
      log(`⚠️ No config found, refunding`);
      await this.refundAndRestart(game);
      return;
    }

    this.games.set(game.roomId, game);

    switch (game.status) {
      case "scheduled":
      case "waiting":
        await this.recoverWaitingGame(game, config);
        break;
      case "in_progress":
        await this.recoverRunningGame(game, config);
        break;
      case "bingo_called":
        await this.recoverGracePeriod(game, config);
        break;
    }
  }

  async recoverWaitingGame(game, config) {
    const pc = this.getPlayerCount(game);
    const elapsed = game.timerStartedAt
      ? (Date.now() - game.timerStartedAt.getTime()) / 1000
      : 0;
    const tr = Math.max(0, config.waitTimeSeconds - elapsed);

    log(
      `⏱️ Recovering waiting game - Elapsed: ${elapsed}s, Remaining: ${tr}s, Players: ${pc}/${config.minPlayersToStart}`,
    );

    if (tr <= 0 && pc >= config.minPlayersToStart) {
      await this.startGame(game.roomId, game, config);
    } else if (tr <= 0) {
      this.startPlayerPoll(game.roomId, game, config);
    } else {
      this.startCountdown(game.roomId, game, config);
    }
  }

  async recoverRunningGame(game, config) {
    log(
      `🏃 Recovering running game - Drawn: ${game.drawnNumbers?.length || 0} numbers`,
    );
    let idx = game.drawnNumbers.length;

    timerManager.createInterval(
      `draw_${game.roomId}`,
      async () => {
        const current = await Game.findById(game._id);
        if (
          !current ||
          current.status === "completed" ||
          current.status === "grace_period"
        ) {
          timerManager.clearInterval(`draw_${game.roomId}`);
          return;
        }
        if (idx >= current.allNumbers.length) {
          timerManager.clearInterval(`draw_${game.roomId}`);
          await this.endGame(game.roomId, current);
          return;
        }
        const num = current.allNumbers[idx],
          letter = this.getBingoLetter(num);
        current.currentNumber = { number: num, letter };
        current.drawnNumbers.push({ number: num, letter });
        await current.save();
        this.io
          .to(game.roomId)
          .emit("numberDrawn", { number: num, letter, drawCount: idx + 1 });
        idx++;
      },
      config.drawIntervalSeconds * 1000,
      "number_draw",
    );
  }

  async recoverGracePeriod(game, config) {
    const ge = game.gracePeriodEndTime
      ? (Date.now() - game.gracePeriodEndTime.getTime()) / 1000
      : 999;
    log(`⏰ Recovering grace period - Time since end: ${ge}s`);

    if (ge >= 0) {
      await this.endGracePeriod(game.roomId, game._id);
    } else {
      timerManager.createTimeout(
        `grace_${game.roomId}`,
        () => this.endGracePeriod(game.roomId, game._id),
        Math.abs(ge) * 1000,
        "grace_period",
      );
    }
  }

  /**
   * Create a new game after a delay (used after game ends/refunds)
   * @param {string} roomId - Room ID
   * @param {number} delay - Delay in milliseconds
   * @returns {Promise<boolean>} Success status
   */
  async createNewGameAfterDelay(roomId, delay) {
    log(`🆕 Creating new game in ${delay}ms for room ${roomId}`);
    return new Promise((resolve) =>
      setTimeout(async () => {
        const config = await GameConfig.findOne({ roomId, isActive: true });
        if (!config) {
          log(`⚠️ No active config for room ${roomId}`);
          resolve(false);
          return;
        }
        const lastNum = await Game.getLatestGameNumber(roomId);
        const newGame = await Game.create({
          gameId: String(lastNum + 1).padStart(10, "0"),
          gameNumber: lastNum + 1,
          roomId,
          status: "scheduled",
          allNumbers: this.shuffleNumbers(),
          timerDuration: config.waitTimeSeconds,
        });
        this.games.set(roomId, newGame);
        this.io.to(roomId).emit("newGameCreated", {
          gameId: newGame.gameId,
          gameNumber: newGame.gameNumber,
        });
        log(`✅ New game created: #${newGame.gameNumber}`);
        resolve(true);
      }, delay),
    );
  }

  /**
   * Initialize a room - create or find active game
   * @param {string} roomId - Room ID
   * @returns {Object|null} Game document or null
   */
  async initializeRoom(roomId) {
    log(`🏠 Initializing room: ${roomId}`);
    const config = await GameConfig.findOne({ roomId, isActive: true });
    if (!config) {
      log(`⚠️ No active config for room ${roomId}`);
      return null;
    }

    let game = await Game.getActiveGame(roomId);
    if (!game) {
      const lastNum = await Game.getLatestGameNumber(roomId);
      game = await Game.create({
        gameId: String(lastNum + 1).padStart(10, "0"),
        gameNumber: lastNum + 1,
        roomId,
        status: "scheduled",
        allNumbers: this.shuffleNumbers(),
        timerDuration: config.waitTimeSeconds,
      });
      log(`🆕 Created new game #${game.gameNumber} for room ${roomId}`);
    } else {
      log(`✅ Found existing game #${game.gameNumber} for room ${roomId}`);
    }

    this.games.set(roomId, game);
    return game;
  }

  // ============================================
  // UTILITY FUNCTIONS
  // ============================================
  /**
   * Fisher-Yates shuffle for numbers 1-75
   * @returns {number[]} Shuffled array
   */
  shuffleNumbers() {
    const n = [];
    for (let i = 1; i <= 75; i++) n.push(i);
    for (let i = n.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [n[i], n[j]] = [n[j], n[i]];
    }
    return n;
  }

  /**
   * Get Bingo letter for a number
   * B: 1-15, I: 16-30, N: 31-45, G: 46-60, O: 61-75
   * @param {number} n - Number
   * @returns {string} Bingo letter
   */
  getBingoLetter(n) {
    if (n <= 15) return "B";
    if (n <= 30) return "I";
    if (n <= 45) return "N";
    if (n <= 60) return "G";
    return "O";
  }

  /**
   * Generate a random 5x5 Bingo grid
   * @returns {Object} Grid object with B,I,N,G,O columns
   */
  generateGrid() {
    const c = {
      B: this.genCol(1, 15),
      I: this.genCol(16, 30),
      N: this.genCol(31, 45),
      G: this.genCol(46, 60),
      O: this.genCol(61, 75),
    };
    c.N[2] = { number: 0, isMarked: true }; // Free space in center
    return c;
  }

  /**
   * Generate a column of 5 unique random numbers within range
   * @param {number} min - Minimum number
   * @param {number} max - Maximum number
   * @returns {Object[]} Array of cell objects
   */
  genCol(min, max) {
    const s = new Set();
    while (s.size < 5) s.add(Math.floor(Math.random() * (max - min + 1)) + min);
    return Array.from(s).map((n) => ({ number: n, isMarked: false }));
  }

  // ============================================
  // CARD OPERATIONS
  // ============================================
  /**
   * Buy a card directly (generates and registers in one step)
   * @param {string} roomId - Room ID
   * @param {string} userId - User ID
   * @returns {Object} Result with card, balance, etc.
   */
  async buyCard(roomId, userId) {
    log(`\n🛒 [BUY CARD] User: ${userId}, Room: ${roomId}`);

    const game = await Game.getActiveGame(roomId);
    if (!game || (game.status !== "scheduled" && game.status !== "waiting")) {
      logError(`❌ Game not available. Status: ${game?.status}`);
      throw new Error("Game not available");
    }

    const config = await GameConfig.findOne({ roomId });
    if (!config) throw new Error("Config not found");

    const player = game.players.find((p) => p.userId.toString() === userId);
    const cc = player?.cards?.length || 0;

    if (cc >= config.maxCardsPerPlayer) {
      logError(`❌ Max cards reached: ${cc}/${config.maxCardsPerPlayer}`);
      throw new Error(`Max ${config.maxCardsPerPlayer} cards`);
    }

    const user = await User.findById(userId);
    if (user.walletBalance < config.cardPrice) {
      logError(
        `❌ Insufficient balance: ${user.walletBalance} < ${config.cardPrice}`,
      );
      throw new Error(`Need ${config.cardPrice} coins`);
    }

    user.walletBalance -= config.cardPrice;
    await user.save();

    const card = await Card.create({
      gameId: game._id,
      userId,
      cardNumber: game.totalCards + 1,
      grid: this.generateGrid(),
      price: config.cardPrice,
      status: "registered",
    });

    if (!player) game.players.push({ userId, cards: [card._id] });
    else player.cards.push(card._id);

    game.totalCards += 1;
    game.prizePool += config.cardPrice;

    await Transaction.create({
      userId,
      type: "card_purchase",
      amount: -config.cardPrice,
      gameId: game.gameId,
      gameNumber: game.gameNumber,
      description: `Card #${card.cardNumber}`,
      balanceAfter: user.walletBalance,
    });

    if (game.players.length === 1 && !game.timerStartedAt) {
      game.timerStartedAt = new Date();
      game.status = "waiting";
      this.startCountdown(roomId, game, config);
    }

    await game.save();

    log(
      `✅ Card purchased: #${card.cardNumber}, Total cards: ${game.totalCards}, Prize pool: ${game.prizePool}, Players: ${game.players.length}`,
    );

    // FIXED: Use 'game' instead of 'ug' (ug was from registerCard method)
    this.io.to(roomId).emit("cardPurchased", {
      cardId: card._id,
      displayId: card.displayId,
      totalCards: game.totalCards,
      playerCount: game.players.length,
      prizePool: game.prizePool,
      timerStartedAt: game.timerStartedAt,
      timerDuration: game.timerDuration,
    });

    return {
      success: true,
      card,
      newBalance: user.walletBalance,
      cardsOwned: cc + 1,
    };
  }

  /**
   * Generate a preview card (not yet purchased)
   * @param {string} roomId - Room ID
   * @param {string} userId - User ID
   * @returns {Object} Result with preview card
   */
  async previewCard(roomId, userId) {
    log(`\n👁️ [PREVIEW CARD] User: ${userId}, Room: ${roomId}`);

    const game = await Game.getActiveGame(roomId);
    if (!game || (game.status !== "scheduled" && game.status !== "waiting")) {
      logError(`❌ Game not available for preview`);
      throw new Error("Game not available");
    }

    const config = await GameConfig.findOne({ roomId });
    const rc = await Card.countDocuments({
      gameId: game._id,
      userId,
      status: "registered",
    });

    if (rc >= config.maxCardsPerPlayer) {
      logError(`❌ Max cards reached: ${rc}/${config.maxCardsPerPlayer}`);
      throw new Error(`Max ${config.maxCardsPerPlayer} cards`);
    }

    const card = await Card.create({
      gameId: game._id,
      userId,
      cardNumber: game.totalCards + 1,
      grid: this.generateGrid(),
      price: config.cardPrice,
      status: "preview",
    });

    log(`✅ Preview card created: ${card._id}, Price: ${card.price} ETB`);

    const sock = this.getUserSocket(userId);
    if (sock) sock.emit("previewCardGenerated", { userId, card });

    return { success: true, card };
  }

  /**
   * Generate multiple preview cards in batch
   * @param {string} roomId - Room ID
   * @param {string} userId - User ID
   * @param {number} quantity - Number of cards to preview
   * @returns {Object} Result with count
   */
  async previewCards(roomId, userId, quantity) {
    console.log("🔴 [BATCH PREVIEW] Called:", { roomId, userId, quantity });

    const game = await Game.getActiveGame(roomId);
    if (!game || (game.status !== "scheduled" && game.status !== "waiting")) {
      console.log("🔴 [BATCH PREVIEW] Game not available:", game?.status);
      throw new Error("Game not available");
    }

    const config = await GameConfig.findOne({ roomId });
    const registeredCount = await Card.countDocuments({
      gameId: game._id,
      userId,
      status: "registered",
    });
    const previewCount = await Card.countDocuments({
      gameId: game._id,
      userId,
      status: "preview",
    });

    console.log("🔴 [BATCH PREVIEW] Counts:", {
      registeredCount,
      previewCount,
      max: config.maxCardsPerPlayer,
    });

    const available = config.maxCardsPerPlayer - registeredCount - previewCount;
    const actualQty = Math.min(quantity, available);
    console.log("🔴 [BATCH PREVIEW] Creating:", actualQty, "cards");

    if (actualQty <= 0)
      throw new Error(`Max ${config.maxCardsPerPlayer} cards`);

    const cards = [];
    for (let i = 0; i < actualQty; i++) {
      cards.push({
        gameId: game._id,
        userId,
        cardId: new (require("mongoose").Types.ObjectId)(),
        cardNumber: game.totalCards + i + 1,
        grid: this.generateGrid(),
        price: config.cardPrice,
        status: "preview",
      });
    }

    const created = await Card.insertMany(cards);
    console.log("🔴 [BATCH PREVIEW] Created:", created.length, "cards");

    const sock = this.getUserSocket(userId);
    if (sock) {
      created.forEach((card) => {
        sock.emit("previewCardGenerated", { userId, card });
      });
    }

    return { success: true, count: created.length };
  }

  /**
   * Register a preview card (purchase it)
   * @param {string} roomId - Room ID
   * @param {string} userId - User ID
   * @param {string} cardId - Card ID to register
   * @returns {Object} Result with card number and new balance
   */
  async registerCard(roomId, userId, cardId) {
    divider();
    log(
      `\n📝 [REGISTER CARD] Starting - User: ${userId}, Card: ${cardId}, Room: ${roomId}`,
    );

    // 1. Validate game
    const game = await Game.getActiveGame(roomId);
    if (!game || (game.status !== "scheduled" && game.status !== "waiting")) {
      logError(`❌ Game not available. Status: ${game?.status}`);
      throw new Error("Game not available");
    }
    log(`✅ Game: #${game.gameNumber}, Status: ${game.status}`);

    // 2. Get config
    const config = await GameConfig.findOne({ roomId });
    if (!config) {
      logError(`❌ Config not found`);
      throw new Error("Config not found");
    }
    log(
      `⚙️ Config: Card Price=${config.cardPrice}, Max Cards=${config.maxCardsPerPlayer}, Commission=${config.commissionPercentage || 10}%`,
    );

    // 3. Validate card
    const card = await Card.findOne({
      _id: cardId,
      $or: [
        { gameId: game._id, userId, status: "preview" },
        {
          _id: cardId,
          userId: null,
          status: { $in: ["available", "preview"] },
        },
      ],
    });
    if (!card) {
      logError(`❌ Card not found or not preview`);
      throw new Error("Card not found");
    }
    log(`🃏 Card: Price=${card.price} ETB`);

    const registeredCount = await Card.countDocuments({
      gameId: game._id,
      userId,
      status: "registered",
    });
    if (registeredCount >= config.maxCardsPerPlayer) {
      throw new Error(
        `Max ${config.maxCardsPerPlayer} cards already registered`,
      );
    }

    // 4. Check balance
    const user = await User.findById(userId);
    if (!user) {
      logError(`❌ User not found`);
      throw new Error("User not found");
    }
    if (user.walletBalance < card.price) {
      logError(
        `❌ Insufficient balance: ${user.walletBalance} < ${card.price}`,
      );
      throw new Error(
        `Need ${card.price} ETB. You have ${user.walletBalance} ETB`,
      );
    }
    log(`💰 Balance: ${user.walletBalance} ETB (sufficient)`);

    // 5. BEFORE state
    log(`\n📊 BEFORE UPDATE:`);
    log(`   totalCards: ${game.totalCards}`);
    log(`   prizePool: ${game.prizePool} ETB`);
    log(`   Expected pool after: ${game.prizePool + card.price} ETB`);
    log(`   players: ${game.players?.length || 0}`);

    // 6. Update game atomically
    const ug = await Game.findOneAndUpdate(
      { _id: game._id, status: { $in: ["scheduled", "waiting"] } },
      {
        $inc: { totalCards: 1, prizePool: card.price },
        $set: {
          timerStartedAt:
            game.players.length === 0 ? new Date() : game.timerStartedAt,
          status: game.players.length === 0 ? "waiting" : game.status,
        },
      },
      { new: true },
    );

    if (!ug) {
      logError(`❌ Game update failed`);
      throw new Error("Game update failed");
    }

    // 7. AFTER state - VERIFY
    log(`\n📊 AFTER UPDATE:`);
    log(`   totalCards: ${ug.totalCards} (was ${game.totalCards}, +1)`);
    log(
      `   prizePool: ${ug.prizePool} ETB (was ${game.prizePool}, +${card.price})`,
    );
    log(
      `   Expected: ${ug.totalCards} × ${card.price} = ${ug.totalCards * card.price} ETB`,
    );
    log(`   Actual: ${ug.prizePool} ETB`);

    // PRIZE POOL VERIFICATION
    if (ug.prizePool !== ug.totalCards * card.price) {
      logError(`\n⚠️⚠️⚠️ PRIZE POOL MISMATCH! ⚠️⚠️⚠️`);
      logError(`   Expected: ${ug.totalCards * card.price} ETB`);
      logError(`   Actual: ${ug.prizePool} ETB`);
      logError(
        `   Difference: ${ug.prizePool - ug.totalCards * card.price} ETB`,
      );
    } else {
      log(
        `✅ Prize pool verified: ${ug.prizePool} ETB = ${ug.totalCards} × ${card.price}`,
      );
    }

    // 8. Update card status
    card.userId = userId;
    card.gameId = ug._id;
    card.status = "registered";
    card.cardNumber = ug.totalCards;
    card.registeredAt = new Date();
    await card.save();

    // 9. Add to players array
    const pi = ug.players.findIndex((p) => p.userId.toString() === userId);
    if (pi === -1) {
      ug.players.push({ userId, cards: [card._id] });
      log(`👤 New player added. Total: ${ug.players.length}`);
    } else {
      ug.players[pi].cards.push(card._id);
      log(`👤 Existing player. Cards: ${ug.players[pi].cards.length}`);
    }
    await ug.save();

    // 10. Deduct balance
    const oldBalance = user.walletBalance;
    user.walletBalance -= card.price;
    await user.save();
    log(`💰 Balance: ${oldBalance} → ${user.walletBalance} (-${card.price})`);

    // 11. Create transaction record
    await Transaction.create({
      userId,
      type: "card_purchase",
      amount: -card.price,
      gameId: ug.gameId,
      gameNumber: ug.gameNumber,
      description: `Card #${card.cardNumber}`,
      balanceAfter: user.walletBalance,
      cardId: card._id,
    });
    log(`📄 Transaction created`);

    if (!ug.timerStartedAt) {
      ug.timerStartedAt = new Date();
      await ug.save();
    }

    // 12. Start countdown for first player
    if (ug.players.length === 1) {
      log(`⏱️ First player! Starting countdown...`);
      this.startCountdown(roomId, ug, config);
    }

    // 13. Emit events
    log(`\n📡 Emitting events:`);
    log(
      `   cardRegistered → room: totalCards=${ug.totalCards}, prizePool=${ug.prizePool}, players=${ug.players.length}`,
    );
    log(`   balanceUpdated → user: newBalance=${user.walletBalance}`);

    this.io.to(roomId).emit("cardRegistered", {
      userId,
      cardId: card._id,
      cardNumber: card.cardNumber,
      totalCards: ug.totalCards,
      playerCount: ug.players.length,
      prizePool: ug.prizePool,
      timerStartedAt: ug.timerStartedAt,
      timerDuration: ug.timerDuration,
    });

    const sock = this.getUserSocket(userId);
    if (sock) {
      sock.emit("balanceUpdated", {
        newBalance: user.walletBalance,
        cardNumber: card.cardNumber,
      });
    }

    log(`✅ Registration complete! Card #${card.cardNumber}`);
    divider();

    return {
      success: true,
      cardNumber: card.cardNumber,
      newBalance: user.walletBalance,
    };
  }

  /**
   * Cancel a preview card (remove it)
   * @param {string} roomId - Room ID
   * @param {string} userId - User ID
   * @param {string} cardId - Card ID to cancel
   * @returns {Object} Success status
   */
  async cancelPreviewCard(roomId, userId, cardId) {
    log(`🗑️ [CANCEL PREVIEW] User: ${userId}, Card: ${cardId}`);
    await Card.deleteOne({ _id: cardId, userId, status: "preview" });
    const sock = this.getUserSocket(userId);
    if (sock) sock.emit("previewCardCancelled", { userId, cardId });
    return { success: true };
  }

  // ============================================
  // GAME START LOGIC
  // ============================================
  /**
   * Start countdown timer for game start
   * @param {string} roomId - Room ID
   * @param {Object} game - Game document
   * @param {Object} config - Game config
   */
  startCountdown(roomId, game, config) {
    log(
      `\n⏱️ [COUNTDOWN] Starting - ${config.waitTimeSeconds}s for Game #${game.gameNumber}`,
    );
    timerManager.clearTimeout(`countdown_${roomId}`);
    timerManager.clearInterval(`poll_${roomId}`);

    timerManager.createTimeout(
      `countdown_${roomId}`,
      async () => {
        try {
          const current = await Game.findById(game._id);
          if (!current || current.status === "completed") {
            log(`[COUNTDOWN] Game already completed, skipping`);
            return;
          }

          const playerCount = current.players ? current.players.length : 0;
          log(`\n⏰ [COUNTDOWN EXPIRED] Game #${current.gameNumber}`);
          log(`   Players: ${playerCount}/${config.minPlayersToStart}`);
          log(`   Total cards: ${current.totalCards}`);
          log(`   Prize pool: ${current.prizePool} ETB`);

          if (playerCount >= config.minPlayersToStart) {
            log(`   ✅ STARTING GAME!`);
            await this.startGame(roomId, current, config);
          } else if (playerCount === 0 && config.resetOnNoPlayers) {
            log(`   🔄 No players, resetting timer`);
            current.timerStartedAt = new Date();
            current.status = "waiting";
            await current.save();
            this.io.to(roomId).emit("countdownReset", {
              timerStartedAt: current.timerStartedAt,
              timerDuration: config.waitTimeSeconds,
            });
            this.startCountdown(roomId, current, config);
          } else {
            log(`   ⏳ Not enough players, starting poll`);
            this.startPlayerPoll(roomId, current, config);
          }
        } catch (e) {
          logError(`❌ [COUNTDOWN] Error:`, e);
        }
      },
      config.waitTimeSeconds * 1000,
      "game_countdown",
    );
  }

  /**
   * Start polling for more players when countdown expires without enough players
   * @param {string} roomId - Room ID
   * @param {Object} game - Game document
   * @param {Object} config - Game config
   */
  startPlayerPoll(roomId, game, config) {
    const pc = this.getPlayerCount(game);
    log(
      `\n🔍 [POLL] Starting - Players: ${pc}/${config.minPlayersToStart} for Game #${game.gameNumber}`,
    );

    this.io
      .to(roomId)
      .emit("waitingForPlayers", {
        needPlayers: config.minPlayersToStart - pc,
      });

    timerManager.createInterval(
      `poll_${roomId}`,
      async () => {
        try {
          const updated = await Game.findById(game._id);
          if (!updated || updated.status === "completed") {
            timerManager.clearInterval(`poll_${roomId}`);
            return;
          }

          const currentPlayers = updated.players ? updated.players.length : 0;

          if (currentPlayers >= config.minPlayersToStart) {
            log(
              `\n✅ [POLL] Enough players! (${currentPlayers}/${config.minPlayersToStart})`,
            );
            timerManager.clearInterval(`poll_${roomId}`);
            await this.startGame(roomId, updated, config);
          } else if (currentPlayers === 0 && config.resetOnNoPlayers) {
            log(`\n🔄 [POLL] All players left, resetting`);
            timerManager.clearInterval(`poll_${roomId}`);
            updated.timerStartedAt = new Date();
            await updated.save();
            this.io
              .to(roomId)
              .emit("countdownReset", {
                timerStartedAt: updated.timerStartedAt,
              });
            this.startCountdown(roomId, updated, config);
          }
        } catch (e) {
          logError(`❌ [POLL] Error:`, e);
        }
      },
      3000,
      "player_poll",
    );
  }

  /**
   * Verify and fix game state (recalculate totals from cards)
   * @param {string} roomId - Room ID
   * @returns {Object} Fixed game state
   */
  async verifyAndFixGame(roomId) {
    const game = await Game.getActiveGame(roomId);
    if (!game) return { error: "No active game" };

    console.log(`\n🔍 [VERIFY] Game #${game.gameNumber}`);

    const cards = await Card.find({
      gameId: game._id,
      status: "registered",
    });

    const calculatedTotalCards = cards.length;
    const calculatedPrizePool = cards.reduce(
      (sum, card) => sum + card.price,
      0,
    );
    const uniquePlayers = new Set(cards.map((c) => c.userId.toString()));
    const calculatedPlayerCount = uniquePlayers.size;

    console.log(
      `   Cards: ${calculatedTotalCards}, Pool: ${calculatedPrizePool} ETB, Players: ${calculatedPlayerCount}`,
    );
    console.log(
      `   Stored: totalCards=${game.totalCards}, pool=${game.prizePool}, players=${game.players?.length}`,
    );

    let needsFix = false;

    if (game.totalCards !== calculatedTotalCards) {
      console.log(
        `   ⚠️ Fixing totalCards: ${game.totalCards} → ${calculatedTotalCards}`,
      );
      game.totalCards = calculatedTotalCards;
      needsFix = true;
    }

    if (game.prizePool !== calculatedPrizePool) {
      console.log(
        `   ⚠️ Fixing prizePool: ${game.prizePool} → ${calculatedPrizePool}`,
      );
      game.prizePool = calculatedPrizePool;
      needsFix = true;
    }

    if (game.players?.length !== calculatedPlayerCount) {
      const playerMap = new Map();
      for (const card of cards) {
        const uid = card.userId.toString();
        if (!playerMap.has(uid)) playerMap.set(uid, []);
        playerMap.get(uid).push(card._id);
      }
      game.players = Array.from(playerMap.entries()).map(
        ([userId, cardIds]) => ({
          userId,
          cards: cardIds,
        }),
      );
      needsFix = true;
    }

    if (needsFix) {
      await game.save();
      console.log(`   ✅ Fixed!`);
      this.io.to(roomId).emit("gameStateCorrected", {
        totalCards: game.totalCards,
        prizePool: game.prizePool,
        playerCount: game.players.length,
      });
    } else {
      console.log(`   ✅ All correct`);
    }

    return {
      totalCards: game.totalCards,
      prizePool: game.prizePool,
      playerCount: game.players.length,
      needsFix,
    };
  }

  /**
   * Start the game - begin drawing numbers
   * @param {string} roomId - Room ID
   * @param {Object} game - Game document
   * @param {Object} config - Game config (contains winRule)
   */
  async startGame(roomId, game, config) {
    divider();
    log(`\n🚀 *** GAME #${game.gameNumber} STARTING! ***`);
    log(`   Players: ${this.getPlayerCount(game)}`);
    log(`   Total cards: ${game.totalCards}`);
    log(`   Prize pool: ${game.prizePool} ETB`);
    log(`   Card price: ${config.cardPrice} ETB`);
    log(`   Commission: ${config.commissionPercentage || 10}%`);
    log(
      `   Expected winners prize: ${game.prizePool * (1 - (config.commissionPercentage || 10) / 100)} ETB`,
    );
    divider();

    await this.verifyAndFixGame(roomId);
    const verifiedGame = await Game.findById(game._id);

    console.log(`\n🚀 *** GAME #${verifiedGame.gameNumber} STARTING! ***`);
    console.log(`   Players: ${this.getPlayerCount(verifiedGame)}`);
    console.log(`   Total cards: ${verifiedGame.totalCards}`);
    console.log(`   Prize pool: ${verifiedGame.prizePool} ETB`);
    console.log(
      `   Expected prize: ${verifiedGame.prizePool * (1 - (config?.commissionPercentage || 10) / 100)} ETB`,
    );

    timerManager.clearInterval(`poll_${roomId}`);
    game.status = "in_progress";
    game.startTime = new Date();
    await game.save();

    this.io.to(roomId).emit("mainBingoStarted", {
      gameId: game.gameId,
      gameNumber: game.gameNumber,
      prizePool: game.prizePool,
      playerCount: this.getPlayerCount(game),
      totalCards: game.totalCards,
    });

    this.drawNumbers(roomId, game, config);
  }

  /**
   * Draw numbers at configured intervals
   * FIXED: Auto-bingo check now passes config.winRule as 4th parameter
   * @param {string} roomId - Room ID
   * @param {Object} game - Game document
   * @param {Object} config - Game config (contains winRule)
   */
  drawNumbers(roomId, game, config) {
    log(
      `\n🎯 [DRAW] Starting number draws - Interval: ${config.drawIntervalSeconds}s`,
    );
    let idx = 0;
    timerManager.clearInterval(`draw_${roomId}`);

    timerManager.createInterval(
      `draw_${roomId}`,
      async () => {
        const current = await Game.findById(game._id);
        if (
          !current ||
          current.status === "completed" ||
          current.status === "grace_period"
        ) {
          timerManager.clearInterval(`draw_${roomId}`);
          return;
        }

        if (idx >= current.allNumbers.length) {
          log(
            `\n🏁 [DRAW] All numbers drawn! Ending game #${current.gameNumber}`,
          );
          timerManager.clearInterval(`draw_${roomId}`);
          await this.endGame(roomId, current);
          return;
        }

        const activeCards = await Card.countDocuments({
          gameId: current._id,
          status: "registered",
          isBlocked: false,
          bingoCalled: false,
        });

        // All cards blocked - refund everyone
        if (activeCards === 0 && current.totalCards > 0) {
          log(
            `\n🚫 [DRAW] All cards blocked! Ending game #${current.gameNumber}`,
          );
          timerManager.clearInterval(`draw_${roomId}`);

          const cards = await Card.find({
            gameId: current._id,
            status: "registered",
          });
          log(`   Refunding ${cards.length} cards...`);

          for (const card of cards) {
            const user = await User.findById(card.userId);
            if (user) {
              user.walletBalance += card.price;
              await user.save();
              await Transaction.create({
                userId: user._id,
                type: "refund",
                amount: card.price,
                gameId: current.gameId,
                gameNumber: current.gameNumber,
                description: `Refund - all cards blocked in Game #${current.gameNumber}`,
                balanceAfter: user.walletBalance,
              });
              await this.sendRefundNotification(
                user._id,
                card.price,
                current.gameNumber,
                "All cards blocked - refunded",
              );
            }
          }

          current.status = "completed";
          current.endTime = new Date();
          current.endReason = "all_cards_blocked";
          await current.save();

          this.io.to(roomId).emit("gameEnded", {
            gameId: current._id,
            winners: [],
            prizePool: current.prizePool,
            reason: "All cards blocked - refunded",
            refunded: true,
          });

          setTimeout(async () => {
            const conf = await GameConfig.findOne({ roomId });
            if (conf) {
              const ln = await Game.getLatestGameNumber(roomId);
              const ng = await Game.create({
                gameId: String(ln + 1).padStart(10, "0"),
                gameNumber: ln + 1,
                roomId,
                status: "scheduled",
                allNumbers: this.shuffleNumbers(),
                timerDuration: conf.waitTimeSeconds,
              });
              this.games.set(roomId, ng);
              this.io
                .to(roomId)
                .emit("newGameCreated", {
                  gameId: ng.gameId,
                  gameNumber: ng.gameNumber,
                });
            }
          }, 5000);
          return;
        }

        // Draw next number
        const num = current.allNumbers[idx],
          letter = this.getBingoLetter(num);
        current.currentNumber = { number: num, letter };
        current.drawnNumbers.push({ number: num, letter });
        await current.save();

        if (idx % 10 === 0 || idx === current.allNumbers.length - 1) {
          log(
            `🎯 [DRAW] #${idx + 1}: ${letter}${num} (${activeCards} active cards)`,
          );
        }

        this.io.to(roomId).emit("mainBingoNumberDrawn", {
          number: num,
          letter,
          drawCount: idx + 1,
          totalNumbers: current.allNumbers.length,
        });

        // 🔥 AUTO BINGO CHECK - FIXED: Pass config.winRule as 4th parameter
        if (config?.autoBingoEnabled) {
          const allRegisteredCards = await Card.find({
            gameId: current._id,
            status: "registered",
            isBlocked: false,
            bingoCalled: false,
          });

          for (const card of allRegisteredCards) {
            // FIXED: Added 4th parameter config.winRule for win rule validation
            const winType = this.checkWin(
              card,
              current.drawnNumbers,
              config,
              config.winRule,
            );
            if (winType) {
              card.bingoCalled = true;
              card.bingoCallTime = new Date();
              card.winType = winType;
              await card.save();

              if (current.status === "in_progress") {
                timerManager.clearInterval(`draw_${roomId}`);
                current.status = "bingo_called";
                current.gracePeriodEndTime = new Date(
                  Date.now() + (config.gracePeriodSeconds || 10) * 1000,
                );
                await current.save();
                this.io.to(roomId).emit("mainBingoFirstBingo", {
                  userId: card.userId,
                  cardId: card._id,
                  cardNumber: card.cardNumber,
                  winType,
                  autoBingo: true,
                  gracePeriodSeconds: config.gracePeriodSeconds || 10,
                });
                timerManager.createTimeout(
                  `grace_${roomId}`,
                  () => this.endGracePeriod(roomId, current._id),
                  (config.gracePeriodSeconds || 10) * 1000,
                  "grace_period",
                );
                return;
              } else {
                this.io.to(roomId).emit("mainBingoAdditionalBingo", {
                  userId: card.userId,
                  cardId: card._id,
                  cardNumber: card.cardNumber,
                  winType,
                  autoBingo: true,
                });
              }
            }
          }
        }

        idx++;
      },
      config.drawIntervalSeconds * 1000,
      "number_draw",
    );
  }

  // ============================================
  // WIN CHECKING
  // ============================================
  /**
   * Check if a card has a winning pattern
   *
   * ⚠️ MAINTENANCE ALERT: This method requires exactly 4 parameters.
   * Always call as: this.checkWin(card, drawnNumbers, config, config.winRule)
   *
   * @param {Object} card - Card document with grid
   * @param {Array} drawnNumbers - Array of drawn {number, letter} objects
   * @param {Object} config - Game config (lineDirections, minRows, etc.)
   * @param {Object} rule - Win rule object (method: 'pattern'|'rule', patterns array, etc.)
   * @returns {string|null} Win type ('pattern', 'line', 'four_corners') or null
   */
  checkWin(card, drawnNumbers, config, rule) {
    const drawnSet = new Set(drawnNumbers.map((d) => d.number));
    const COLS = ["B", "I", "N", "G", "O"];
    const gridSize = 5;

    // Last number check (if enabled in config)
    if (config?.isLastNumberCalledBingo && drawnNumbers.length > 0) {
      const lastCalled = drawnNumbers[drawnNumbers.length - 1];
      const lastCell = card.grid[lastCalled.letter]?.find(
        (c) => c.number === lastCalled.number,
      );
      if (!lastCell) return null;
    }

    // Build effective marked set (drawn numbers that are on this card + free space)
    const effectiveMarkedSet = new Set();
    for (const col of COLS) {
      for (let r = 0; r < gridSize; r++) {
        const cell = card.grid[col]?.[r];
        if (cell && drawnSet.has(cell.number)) {
          effectiveMarkedSet.add(`${col},${r}`);
        }
      }
    }

    // Add free space (center N cell) if enabled
    if (
      config?.freeSpaceCounts !== false &&
      config?.freeSpaceBlocked !== true
    ) {
      effectiveMarkedSet.add("N,2");
    }

    // Quick check - need at least some marks
    if (effectiveMarkedSet.size === 0) return null;

    // ══════════════════════════════════════════════════════
    // PATTERN METHOD: Check if card matches any saved pattern
    // ══════════════════════════════════════════════════════
    if (rule?.method === "pattern" && rule?.patterns?.length > 0) {
      for (const pattern of rule.patterns) {
        if (!pattern.cells || pattern.cells.length === 0) continue;

        const allMatch = pattern.cells.every((cell) => {
          let row, col;

          // Handle both formats: [row, col] or "row col" string
          if (Array.isArray(cell)) {
            [row, col] = cell;
          } else if (typeof cell === "string") {
            const parts = cell.split(" ");
            row = parseInt(parts[0]);
            col = parseInt(parts[1]);
          } else {
            return false;
          }

          // Validate bounds
          if (row < 0 || row >= gridSize || col < 0 || col >= gridSize)
            return false;

          const colLetter = COLS[col];
          return effectiveMarkedSet.has(`${colLetter},${row}`);
        });

        if (allMatch) {
          return "pattern";
        }
      }
      return null; // Pattern method requires a pattern match
    }

    // ══════════════════════════════════════════════════════
    // RULE METHOD: Check lines, squares, rectangles
    // ══════════════════════════════════════════════════════

    const completedLines = [];
    const lineDirections = config?.lineDirections || [
      "horizontal",
      "vertical",
      "diagonal",
    ];

    // --- ROWS (horizontal) ---
    if (lineDirections.includes("horizontal")) {
      for (let r = 0; r < gridSize; r++) {
        let complete = true;
        const cells = [];
        for (let c = 0; c < gridSize; c++) {
          const col = COLS[c];
          if (!effectiveMarkedSet.has(`${col},${r}`)) {
            complete = false;
            break;
          }
          cells.push([c, r]);
        }
        if (complete)
          completedLines.push({ type: "horizontal", index: r, cells });
      }
    }

    // --- COLUMNS (vertical) ---
    if (lineDirections.includes("vertical")) {
      for (let c = 0; c < gridSize; c++) {
        const col = COLS[c];
        let complete = true;
        const cells = [];
        for (let r = 0; r < gridSize; r++) {
          if (!effectiveMarkedSet.has(`${col},${r}`)) {
            complete = false;
            break;
          }
          cells.push([c, r]);
        }
        if (complete)
          completedLines.push({ type: "vertical", index: c, cells });
      }
    }

    // --- DIAGONALS ---
    if (lineDirections.includes("diagonal")) {
      // Main diagonal (top-left to bottom-right)
      let d1Complete = true;
      const d1Cells = [];
      for (let i = 0; i < gridSize; i++) {
        if (!effectiveMarkedSet.has(`${COLS[i]},${i}`)) {
          d1Complete = false;
          break;
        }
        d1Cells.push([i, i]);
      }
      if (d1Complete)
        completedLines.push({ type: "diagonal", index: 1, cells: d1Cells });

      // Anti-diagonal (top-right to bottom-left)
      let d2Complete = true;
      const d2Cells = [];
      for (let i = 0; i < gridSize; i++) {
        if (!effectiveMarkedSet.has(`${COLS[gridSize - 1 - i]},${i}`)) {
          d2Complete = false;
          break;
        }
        d2Cells.push([gridSize - 1 - i, i]);
      }
      if (d2Complete)
        completedLines.push({ type: "diagonal", index: 2, cells: d2Cells });
    }

    // --- SQUARES (N×N blocks) ---
    let squaresFound = 0;
    if (lineDirections.includes("square")) {
      const minSize = config?.squareMinSize || 2;
      const maxSize = config?.squareMaxSize || 2;

      for (let size = minSize; size <= maxSize; size++) {
        for (let r = 0; r <= gridSize - size; r++) {
          for (let c = 0; c <= gridSize - size; c++) {
            let complete = true;
            const cells = [];
            for (let i = 0; i < size; i++) {
              for (let j = 0; j < size; j++) {
                const col = COLS[c + j];
                if (!effectiveMarkedSet.has(`${col},${r + i}`)) {
                  complete = false;
                  break;
                }
                cells.push([c + j, r + i]);
              }
              if (!complete) break;
            }
            if (complete) {
              squaresFound++;
              completedLines.push({
                type: "square",
                size,
                row: r,
                col: c,
                cells,
              });
            }
          }
        }
      }
    }

    // --- RECTANGLES (W×H blocks) ---
    let rectanglesFound = 0;
    if (lineDirections.includes("rectangle")) {
      const minW = config?.rectMinWidth || 3;
      const maxW = config?.rectMaxWidth || 3;
      const minH = config?.rectMinHeight || 2;
      const maxH = config?.rectMaxHeight || 2;

      for (let w = minW; w <= maxW; w++) {
        for (let h = minH; h <= maxH; h++) {
          if (w === h) continue; // Skip squares (already counted)
          for (let r = 0; r <= gridSize - h; r++) {
            for (let c = 0; c <= gridSize - w; c++) {
              let complete = true;
              const cells = [];
              for (let i = 0; i < h; i++) {
                for (let j = 0; j < w; j++) {
                  const col = COLS[c + j];
                  if (!effectiveMarkedSet.has(`${col},${r + i}`)) {
                    complete = false;
                    break;
                  }
                  cells.push([c + j, r + i]);
                }
                if (!complete) break;
              }
              if (complete) {
                rectanglesFound++;
                completedLines.push({
                  type: "rectangle",
                  width: w,
                  height: h,
                  row: r,
                  col: c,
                  cells,
                });
              }
            }
          }
        }
      }
    }

    // --- COUNT BY TYPE ---
    let rowsFound = completedLines.filter(
      (l) => l.type === "horizontal",
    ).length;
    let colsFound = completedLines.filter((l) => l.type === "vertical").length;
    let diagsFound = completedLines.filter((l) => l.type === "diagonal").length;
    let totalLines =
      rowsFound + colsFound + diagsFound + squaresFound + rectanglesFound;

    // --- OVERLAP CHECK ---
    if (config?.allowOverlapping === false) {
      const uniqueLines = [];
      const usedCells = new Set();

      for (const line of completedLines) {
        const lineCellKeys = line.cells.map(([c, r]) => `${c},${r}`);
        const hasOverlap = lineCellKeys.some((key) => usedCells.has(key));

        if (!hasOverlap) {
          uniqueLines.push(line);
          lineCellKeys.forEach((key) => usedCells.add(key));
        }
      }

      rowsFound = uniqueLines.filter((l) => l.type === "horizontal").length;
      colsFound = uniqueLines.filter((l) => l.type === "vertical").length;
      diagsFound = uniqueLines.filter((l) => l.type === "diagonal").length;
      squaresFound = uniqueLines.filter((l) => l.type === "square").length;
      rectanglesFound = uniqueLines.filter(
        (l) => l.type === "rectangle",
      ).length;
      totalLines =
        rowsFound + colsFound + diagsFound + squaresFound + rectanglesFound;
    }

    // --- EXACT COUNT CHECKS ---
    if (
      config?.exactRows !== null &&
      config.exactRows !== undefined &&
      rowsFound !== config.exactRows
    )
      return null;
    if (
      config?.exactColumns !== null &&
      config.exactColumns !== undefined &&
      colsFound !== config.exactColumns
    )
      return null;
    if (
      config?.exactDiagonals !== null &&
      config.exactDiagonals !== undefined &&
      diagsFound !== config.exactDiagonals
    )
      return null;
    if (
      config?.exactSquares !== null &&
      config.exactSquares !== undefined &&
      squaresFound !== config.exactSquares
    )
      return null;
    if (
      config?.exactRectangles !== null &&
      config.exactRectangles !== undefined &&
      rectanglesFound !== config.exactRectangles
    )
      return null;

    // --- MAX COUNT CHECKS ---
    if (
      config?.maxRows !== null &&
      config.maxRows !== undefined &&
      rowsFound > config.maxRows
    )
      return null;
    if (
      config?.maxColumns !== null &&
      config.maxColumns !== undefined &&
      colsFound > config.maxColumns
    )
      return null;
    if (
      config?.maxDiagonals !== null &&
      config.maxDiagonals !== undefined &&
      diagsFound > config.maxDiagonals
    )
      return null;
    if (
      config?.maxSquares !== null &&
      config.maxSquares !== undefined &&
      squaresFound > config.maxSquares
    )
      return null;
    if (
      config?.maxRectangles !== null &&
      config.maxRectangles !== undefined &&
      rectanglesFound > config.maxRectangles
    )
      return null;

    // --- CORNERS CHECK ---
    if (config?.cornersRequired) {
      const cornersOk =
        effectiveMarkedSet.has("B,0") &&
        effectiveMarkedSet.has("O,0") &&
        effectiveMarkedSet.has("B,4") &&
        effectiveMarkedSet.has("O,4");
      if (!cornersOk) return null;
    }

    // --- FREE SPACE REQUIRED ---
    if (config?.freeSpaceRequiredForWin && !effectiveMarkedSet.has("N,2")) {
      return null;
    }

    // --- MIN CELLS MARKED ---
    if (
      config?.minCellsMarked !== null &&
      config.minCellsMarked !== undefined
    ) {
      const markedCount = effectiveMarkedSet.size;
      if (markedCount < config.minCellsMarked) return null;
    }

    // --- FINAL WIN CHECK ---
    const meetsMinimums =
      rowsFound >= (config?.minRows || 0) &&
      colsFound >= (config?.minColumns || 0) &&
      diagsFound >= (config?.minDiagonals || 0) &&
      squaresFound >= (config?.minSquares || 0) &&
      rectanglesFound >= (config?.minRectangles || 0) &&
      totalLines >= (config?.linesToWin || 1);

    if (meetsMinimums) {
      return "line";
    }

    // --- FOUR CORNERS (fallback) ---
    if (
      effectiveMarkedSet.has("B,0") &&
      effectiveMarkedSet.has("O,0") &&
      effectiveMarkedSet.has("B,4") &&
      effectiveMarkedSet.has("O,4")
    ) {
      return "four_corners";
    }

    return null;
  }

  // ============================================
  // BINGO CALLING
  // ============================================
  /**
   * Handle a player calling Bingo
   * FIXED: checkWin now passes config.winRule as 4th parameter
   * @param {string} roomId - Room ID
   * @param {string} userId - User ID
   * @param {string} cardId - Card ID
   * @returns {Object} Result with winType or falseBingo flag
   */
  async callBingo(roomId, userId, cardId) {
    divider();
    log(`\n🎉 [BINGO CALL] User: ${userId}, Card: ${cardId}, Room: ${roomId}`);

    const game = await Game.getActiveGame(roomId);
    if (
      !game ||
      (game.status !== "in_progress" && game.status !== "bingo_called")
    ) {
      logError(`❌ Game not in progress. Status: ${game?.status}`);
      throw new Error("Game not in progress");
    }
    log(
      `   Game: #${game.gameNumber}, Status: ${game.status}, Drawn: ${game.drawnNumbers?.length || 0} numbers`,
    );

    const card = await Card.findOne({
      _id: cardId,
      userId,
      gameId: game._id,
      status: "registered",
    });
    if (!card || card.isBlocked) {
      logError(`❌ Card not valid or blocked`);
      throw new Error("Card not valid");
    }
    if (card.bingoCalled) {
      logError(`❌ Bingo already called on this card`);
      throw new Error("Bingo already called");
    }

    const config = await GameConfig.findOne({ roomId });
    const lastCalled = game.drawnNumbers?.[game.drawnNumbers.length - 1];

    // Check if last number must be on card for valid bingo
    if (config?.isLastNumberCalledBingo && lastCalled) {
      const lastCell = card.grid[lastCalled.letter]?.find(
        (c) => c.number === lastCalled.number,
      );
      if (!lastCell) {
        log(
          `❌ FALSE BINGO: Last number ${lastCalled.letter}${lastCalled.number} not on card`,
        );
        card.isBlocked = true;
        card.blockReason = "Last number not on card";
        await card.save();
        this.io.to(roomId).emit("mainBingoFalseBingo", {
          userId,
          cardId,
          cardNumber: card.cardNumber,
          reason: `Last number ${lastCalled.letter}${lastCalled.number} not on card`,
        });
        return {
          success: false,
          falseBingo: true,
          reason: "last_number_not_on_card",
        };
      }
    }

    // FIXED: Pass config.winRule as 4th parameter for win rule validation
    const winType = this.checkWin(
      card,
      game.drawnNumbers,
      config,
      config.winRule,
    );

    if (!winType) {
      log(`❌ FALSE BINGO: No winning pattern`);
      card.isBlocked = true;
      card.blockReason = "no_win";
      await card.save();
      this.io
        .to(roomId)
        .emit("mainBingoFalseBingo", {
          userId,
          cardId,
          cardNumber: card.cardNumber,
          reason: "no_win",
        });
      return { success: false, falseBingo: true, reason: "no_win" };
    }

    log(`✅ VALID BINGO! Type: ${winType}`);

    // Auto-mark winning numbers
    const drawnSet = new Set(game.drawnNumbers.map((d) => d.number));
    for (let c of ["B", "I", "N", "G", "O"]) {
      for (let cell of card.grid[c]) {
        if (drawnSet.has(cell.number) && !cell.isMarked && cell.number > 0) {
          cell.isMarked = true;
        }
      }
    }

    card.bingoCalled = true;
    card.bingoCallTime = new Date();
    card.winType = winType;
    await card.save();

       if (game.status === "in_progress") {
      log(`🥇 FIRST BINGO! Stopping draws...`);
      timerManager.clearInterval(`draw_${roomId}`);
      
      const config = await MainBingoConfig.findById(game.configId);
      const gracePeriodSeconds = config?.gracePeriodSeconds || 10;
      
      game.status = "bingo_called";
      await game.save();
      
      // 🔥 Emit BINGO called to ALL players
      this.io.to(roomId).emit("mainBingoFirstBingo", {
        userId,
        cardId,
        cardNumber: card.cardNumber,
        winType,
        winnerName: card.userId?.fullName || 'Player'
      });
      log(`✅ Emitted mainBingoFirstBingo to room`);
      
      // 🔥 Auto-start grace period after 3 seconds
      setTimeout(async () => {
        try {
          log(`⏰ Starting grace period...`);
          const current = await MainBingoGame.findById(game._id);
          
          if (current && current.status === "bingo_called") {
            current.status = "grace_period";
            current.gracePeriodEndTime = new Date(Date.now() + gracePeriodSeconds * 1000);
            await current.save();
            
            // Emit grace period to ALL players
            this.io.to(roomId).emit("mainBingoGracePeriod", {
              seconds: gracePeriodSeconds,
              endTime: current.gracePeriodEndTime
            });
            log(`✅ Emitted mainBingoGracePeriod to room`);
            
            // End game after grace period
            timerManager.createTimeout(
              `grace_${roomId}`,
              () => this.endGracePeriod(roomId, game._id),
              gracePeriodSeconds * 1000,
              "grace_period"
            );
          }
        } catch (err) {
          log(`❌ Grace period error: ${err.message}`);
        }
      }, 3000);
      
    } else {
      log(`🎉 Additional BINGO!`);
      await game.save();
      this.io.to(roomId).emit("mainBingoAdditionalBingo", {
        userId,
        cardId,
        cardNumber: card.cardNumber,
        winType,
      });
    }

    divider();
    return { success: true, winType };
  }

  // ============================================
  // GRACE PERIOD & END GAME
  // ============================================
  /**
   * End game with no winner (all numbers drawn)
   * Refunds all cards and creates new game
   * @param {string} roomId - Room ID
   * @param {Object} game - Game document
   */
  async endGame(roomId, game) {
    divider();
    log(`\n🏁 [END GAME] Game #${game.gameNumber} - No winner`);
    log(`   Prize pool: ${game.prizePool} ETB`);

    game.status = "completed";
    game.endTime = new Date();
    game.endReason = game.endReason || "all_numbers_drawn";
    await game.save();
    console.log("✅ Game saved as completed");

    // Reset ALL 400 seeded cards (displayId 10001-10400)
    const resetResult = await Card.updateMany(
      { displayId: { $gte: 10001, $lte: 10400 } },
      {
        $set: {
          status: "available",
          userId: null,
          gameId: null,
          isBlocked: false,
          bingoCalled: false,
        },
      },
    );
    console.log(
      `🃏 Card reset: ${resetResult.modifiedCount} cards set to available`,
    );

    // Reset grid marks for all 400 cards
    const allCards = await Card.find({
      displayId: { $gte: 10001, $lte: 10400 },
    });
    console.log(`🃏 Found ${allCards.length} cards to reset grid marks`);

    for (const c of allCards) {
      ["B", "I", "N", "G", "O"].forEach((col) => {
        if (c.grid[col]) {
          c.grid[col] = c.grid[col].map((cell) => ({
            ...cell,
            isMarked: cell.number === 0 ? true : false,
          }));
        }
      });
      await c.save();
    }
    console.log("✅ Grid marks reset complete");

    timerManager.clearInterval(`draw_${roomId}`);
    console.log("🧹 Draw timer cleared");

    const cards = await Card.find({ gameId: game._id, status: "registered" });
    console.log(`💰 Found ${cards.length} cards to refund`);
    let totalRefunded = 0;

    log(`   Refunding ${cards.length} cards...`);

    for (const card of cards) {
      const user = await User.findById(card.userId);
      if (user) {
        const oldBalance = user.walletBalance;
        user.walletBalance += card.price;
        await user.save();
        totalRefunded += card.price;

        log(
          `   💰 ${user.fullName}: ${oldBalance} → ${user.walletBalance} (+${card.price})`,
        );

        await Transaction.create({
          userId: user._id,
          type: "refund",
          amount: card.price,
          gameId: game.gameId,
          gameNumber: game.gameNumber,
          description: `Refund - no winner in Game #${game.gameNumber}`,
          balanceAfter: user.walletBalance,
        });
        await this.sendRefundNotification(
          user._id,
          card.price,
          game.gameNumber,
          "No winner - refunded",
        );
      }
    }

    log(`\n💰 Total refunded: ${totalRefunded} ETB to ${cards.length} cards`);

    this.io.to(roomId).emit("mainBingoEnded", {
      gameId: game._id,
      gameNumber: game.gameNumber,
      winners: game.winners,
      prizePool: game.prizePool,
      commission: game.commission,
      balance: game.winners[0]?.newBalance || 0,
      timestamp: new Date().toISOString(),
    });

    divider();

    setTimeout(async () => {
      const conf = await GameConfig.findOne({ roomId: game.roomId });
      if (conf) {
        const ln = await Game.getLatestGameNumber(game.roomId);
        const ng = await Game.create({
          gameId: String(ln + 1).padStart(10, "0"),
          gameNumber: ln + 1,
          roomId: game.roomId,
          status: "scheduled",
          allNumbers: this.shuffleNumbers(),
          timerDuration: conf.waitTimeSeconds,
        });
        this.games.set(game.roomId, ng);
        this.io.to(game.roomId).emit("newGameCreated", {
          gameId: ng.gameId,
          gameNumber: ng.gameNumber,
        });
        log(`🆕 New game #${ng.gameNumber} created`);
      }
    }, 5000);
  }

  /**
   * End grace period - validate winners and distribute prizes
   * FIXED: checkWin now passes config.winRule as 4th parameter
   * @param {string} roomId - Room ID
   * @param {string} gameId - Game MongoDB ID
   */
  async endGracePeriod(roomId, gameId) {
    divider();
    log(`\n⏰ [GRACE PERIOD END] Game: ${gameId}, Room: ${roomId}`);

    const game = await Game.findById(gameId);
    if (!game || game.status === "completed") {
      log(`   Game already completed`);
      return;
    }

    const config = await GameConfig.findOne({ roomId: game.roomId });
    const calledCards = await Card.find({
      gameId: game._id,
      bingoCalled: true,
      isBlocked: false,
    }).populate("userId");

    log(`   Called cards: ${calledCards.length}`);
    log(`   Prize pool: ${game.prizePool} ETB`);
    log(`   Commission: ${config?.commissionPercentage || 10}%`);

    const winners = [];
    for (const card of calledCards) {
      // FIXED: Pass config.winRule as 4th parameter for win rule validation
      const wt = this.checkWin(card, game.drawnNumbers, config, config.winRule);
      if (wt) {
        card.bingoValidated = true;
        await card.save();
        winners.push({ card, winType: wt });
      }
    }

    log(`   Validated winners: ${winners.length}`);

    if (winners.length > 0) {
      const commissionRate = config?.commissionPercentage || 10;
      const comm = (game.prizePool * commissionRate) / 100;
      const ppw = (game.prizePool - comm) / winners.length;

      log(`\n💰 PRIZE CALCULATION:`);
      log(`   Prize pool: ${game.prizePool} ETB`);
      log(`   Commission (${commissionRate}%): ${comm} ETB`);
      log(`   Prize per winner: ${ppw} ETB`);
      log(`   Total payout: ${ppw * winners.length} ETB`);

      for (const { card, winType } of winners) {
        const user = card.userId;
        const oldBalance = user.walletBalance || 0;
        await User.findByIdAndUpdate(user._id, {
          $inc: { walletBalance: ppw },
        });
        const updatedUser = await User.findById(user._id);

        log(
          `   🏆 Winner: ${user.fullName} - ${oldBalance} → ${updatedUser.walletBalance} (+${ppw} ETB) - ${winType}`,
        );

        await Transaction.create({
          userId: user._id,
          type: "prize_win",
          amount: ppw,
          gameId: game.gameId,
          gameNumber: game.gameNumber,
          description: `Won with ${winType}`,
          balanceAfter: updatedUser.walletBalance,
        });

        game.winners.push({
          userId: user._id,
          cardId: card._id,
          winType,
          prizeAmount: ppw,
          winnerName: user.fullName,
          winnerPhone: user.phone,
          cardNumber: card.cardNumber,
          cardGrid: card.grid,
          newBalance: updatedUser.walletBalance,
        });

        await this.sendWinningNotification(
          user._id,
          ppw,
          game.gameNumber,
          winType,
        );
      }

      await Transaction.create({
        type: "commission",
        amount: comm,
        gameId: game.gameId,
        gameNumber: game.gameNumber,
        description: "Commission",
      });
      game.commission = comm;

      log(`\n📡 Emitting gameEnded with winners and balances`);
    } else {
      log(`   No valid winners found`);
    }

    game.status = "completed";
    game.endTime = new Date();
    await game.save();
    console.log("✅ Game saved as completed (grace period)");

    // Reset ALL 400 seeded cards (displayId 10001-10400)
    const resetResult = await Card.updateMany(
      { displayId: { $gte: 10001, $lte: 10400 } },
      {
        $set: {
          status: "available",
          userId: null,
          gameId: null,
          isBlocked: false,
          bingoCalled: false,
        },
      },
    );
    console.log(
      `🃏 Card reset: ${resetResult.modifiedCount} cards set to available`,
    );

    // Reset grid marks for all 400 cards
    const allCards = await Card.find({
      displayId: { $gte: 10001, $lte: 10400 },
    });
    console.log(`🃏 Found ${allCards.length} cards to reset grid marks`);

    for (const c of allCards) {
      ["B", "I", "N", "G", "O"].forEach((col) => {
        if (c.grid[col]) {
          c.grid[col] = c.grid[col].map((cell) => ({
            ...cell,
            isMarked: cell.number === 0 ? true : false,
          }));
        }
      });
      await c.save();
    }
    console.log("✅ Grid marks reset complete");

    timerManager.clearInterval(`draw_${roomId}`);
    timerManager.clearTimeout(`grace_${roomId}`);

       // 🔥 Emit game ended with actual winners
    const winnerData = game.winners.map(w => ({
      userId: w.userId,
      cardId: w.cardId,
      winnerName: w.winnerName,
      winnerPhone: w.winnerPhone,
      cardNumber: w.cardNumber,
      prizeAmount: w.prizeAmount,
      winType: w.winType,
      newBalance: w.newBalance
    }));

    this.io.to(roomId).emit("mainBingoEnded", {
      gameId: game._id,
      gameNumber: game.gameNumber,
      winners: winnerData,
      prizePool: game.prizePool,
      commission: game.commission || 0,
      totalWinners: winners.length,
      timestamp: new Date().toISOString(),
    });
    
    log(`📡 Emitted mainBingoEnded with ${winnerData.length} winners`);

    log(`✅ Game #${game.gameNumber} completed`);
    divider();

    setTimeout(async () => {
      const conf = await GameConfig.findOne({ roomId: game.roomId });
      if (conf) {
        const ln = await Game.getLatestGameNumber(roomId);
        const ng = await Game.create({
          gameId: String(ln + 1).padStart(10, "0"),
          gameNumber: ln + 1,
          roomId,
          status: "scheduled",
          allNumbers: this.shuffleNumbers(),
          timerDuration: conf.waitTimeSeconds,
        });
        this.games.set(roomId, ng);
        this.io.to(roomId).emit("newGameCreated", {
          gameId: ng.gameId,
          gameNumber: ng.gameNumber,
        });
        log(`🆕 New game #${ng.gameNumber} created`);
      }
    }, 5000);
  }

  /**
   * Get current game state for a room/user
   * @param {string} roomId - Room ID
   * @param {string} userId - User ID (optional)
   * @returns {Object|null} Game state object or null
   */
  async getGameState(roomId, userId) {
    const game = await Game.getActiveGame(roomId);
    if (!game) {
      log(`📊 [getGameState] No active game for room ${roomId}`);
      return null;
    }

    const config = await GameConfig.findOne({ roomId });
    const myCards = userId
      ? await Card.find({ gameId: game._id, userId, status: "registered" })
      : [];
    const previewCards = userId
      ? await Card.find({ gameId: game._id, userId, status: "preview" })
      : [];
    const user = userId
      ? await User.findById(userId).select("walletBalance")
      : null;

    const state = {
      gameId: game.gameId,
      gameNumber: game.gameNumber,
      status: game.status,
      playerCount: this.getPlayerCount(game),
      totalCards: game.totalCards,
      prizePool: game.prizePool,
      currentNumber: game.currentNumber,
      drawnNumbers: game.drawnNumbers,
      drawCount: game.drawnNumbers?.length || 0,
      timeRemaining: this.getTimeRemaining(game),
      timerDuration: game.timerDuration,
      timerStartedAt: game.timerStartedAt,
      config: {
        cardPrice: config?.cardPrice,
        maxCardsPerPlayer: config?.maxCardsPerPlayer,
        minPlayersToStart: config?.minPlayersToStart,
        commissionPercentage: config?.commissionPercentage || 10,
        waitTimeSeconds: config?.waitTimeSeconds,
        drawIntervalSeconds: config?.drawIntervalSeconds,
      },
      myCards,
      myCardsCount: myCards.length,
      previewCards,
      previewCardsCount: previewCards.length,
      winners: game.winners,
      balance: user?.walletBalance || 0,
    };

    log(
      `📊 [getGameState] Game #${game.gameNumber} - totalCards: ${game.totalCards}, prizePool: ${game.prizePool}, commission: ${state.config.commissionPercentage}%`,
    );

    return state;
  }

  /**
   * Calculate time remaining on game timer
   * @param {Object} game - Game document
   * @returns {number} Seconds remaining
   */
  getTimeRemaining(game) {
    if (!game.timerStartedAt) return game.timerDuration;
    const elapsed = (Date.now() - game.timerStartedAt.getTime()) / 1000;
    return Math.max(0, game.timerDuration - elapsed);
  }
}

module.exports = GameEngine;
