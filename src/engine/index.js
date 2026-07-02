const NotificationService = require('./notifications');
const RefundService = require('./refunds');
const RecoveryService = require('./recovery');
const CardService = require('./cards');
const GameFlowService = require('./game');
const BingoService = require('./bingo');
const Game = require('../models/Game');
const GameConfig = require('../models/GameConfig');
const timerManager = require('../utils/TimerManager');

class GameEngine {
  constructor(io) {
    this.io = io;
    this.userSockets = new Map();
    this.games = new Map();
    this.activeGames = new Set();
    
    this.notifications = new NotificationService(this);
    this.refunds = new RefundService(this);
    this.recovery = new RecoveryService(this);
    this.cards = new CardService(this);
    this.gameFlow = new GameFlowService(this);
    this.bingo = new BingoService(this);
    
    console.log('🎮 GameEngine initialized');
  }

  setUserSocket(userId, socketId) {
    this.userSockets.set(userId.toString(), socketId);
  }
  
  removeUserSocket(userId) {
    this.userSockets.delete(userId.toString());
  }
  
  getUserSocket(userId) {
    const socketId = this.userSockets.get(userId.toString());
    if (socketId) return this.io.sockets.sockets.get(socketId);
    return null;
  }
  
  cleanup() {
    timerManager.reportStats();
  }

  getPlayerCount(game) {
    if (!game || !game.players || !Array.isArray(game.players)) return 0;
    return game.players.length;
  }

  shuffleNumbers() {
    const n = [];
    for (let i = 1; i <= 75; i++) n.push(i);
    for (let i = n.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [n[i], n[j]] = [n[j], n[i]];
    }
    return n;
  }
  
  getBingoLetter(n) {
    if (n <= 15) return 'B';
    if (n <= 30) return 'I';
    if (n <= 45) return 'N';
    if (n <= 60) return 'G';
    return 'O';
  }
  
  generateGrid() {
    const c = {
      B: this.genCol(1, 15),
      I: this.genCol(16, 30),
      N: this.genCol(31, 45),
      G: this.genCol(46, 60),
      O: this.genCol(61, 75)
    };
    c.N[2] = { number: 0, isMarked: true };
    return c;
  }
  
  genCol(min, max) {
    const s = new Set();
    while (s.size < 5) s.add(Math.floor(Math.random() * (max - min + 1)) + min);
    return Array.from(s).map(n => ({ number: n, isMarked: false }));
  }

  async initializeRoom(roomId) {
    const config = await GameConfig.findOne({ roomId, isActive: true });
    if (!config) return null;
    
    let game = await Game.getActiveGame(roomId);
    if (!game) {
      const lastNum = await Game.getLatestGameNumber(roomId);
      game = await Game.create({
        gameId: String(lastNum + 1).padStart(10, '0'),
        gameNumber: lastNum + 1, roomId,
        status: 'scheduled',
        allNumbers: this.shuffleNumbers(),
        timerDuration: config.waitTimeSeconds
      });
    }
    
    this.games.set(roomId, game);
    return game;
  }

  async getGameState(roomId, userId) {
    const game = await Game.getActiveGame(roomId);
    if (!game) return null;
    
    const config = await GameConfig.findOne({ roomId });
    const Card = require('../models/Card');
    const User = require('../models/User');
    const myCards = userId ? await Card.find({ gameId: game._id, userId, status: 'registered' }) : [];
    const previewCards = userId ? await Card.find({ gameId: game._id, userId, status: 'preview' }) : [];
    const user = userId ? await User.findById(userId).select('walletBalance') : null;
    
    return {
      gameId: game.gameId, gameNumber: game.gameNumber, status: game.status,
      playerCount: this.getPlayerCount(game), totalCards: game.totalCards,
      prizePool: game.prizePool, currentNumber: game.currentNumber,
      drawnNumbers: game.drawnNumbers, drawCount: game.drawnNumbers?.length || 0,
      timeRemaining: this.getTimeRemaining(game),
      timerDuration: game.timerDuration, timerStartedAt: game.timerStartedAt,
      config: {
        cardPrice: config?.cardPrice, maxCardsPerPlayer: config?.maxCardsPerPlayer,
        minPlayersToStart: config?.minPlayersToStart,
        commissionPercentage: config?.commissionPercentage || 10,
        waitTimeSeconds: config?.waitTimeSeconds,
        drawIntervalSeconds: config?.drawIntervalSeconds
      },
      myCards, myCardsCount: myCards.length,
      previewCards, previewCardsCount: previewCards.length,
      winners: game.winners, balance: user?.walletBalance || 0
    };
  }

  getTimeRemaining(game) {
    if (!game.timerStartedAt) return game.timerDuration;
    const elapsed = (Date.now() - game.timerStartedAt.getTime()) / 1000;
    return Math.max(0, game.timerDuration - elapsed);
  }
}

module.exports = GameEngine;