

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Card = require('../models/Card');
const Game = require('../models/Game');


class GameSocket {
  constructor(io, fastEngine, mainEngine) {
    this.io = io;
    this.engine = fastEngine;       // Fast bingo engine
    this.mainEngine = mainEngine;   // Main bingo engine
    this.autoMarkUsers = new Map();
  }

  initialize() {
    // Auth middleware
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        console.log('🔐 [AUTH] Token received:', token ? token.substring(0, 30) + '...' : 'MISSING');
        
        if (!token) {
          console.log('❌ [AUTH] No token provided');
          return next(new Error('Auth required'));
        }
        
        let decoded;
        try {
          decoded = jwt.verify(token, process.env.JWT_SECRET);
          console.log('🔐 [AUTH] Token valid, user:', decoded.id);
        } catch (jwtError) {
          console.log('❌ [AUTH] JWT verify failed:', jwtError.message);
          return next(new Error('Invalid token'));
        }
        
        const user = await User.findById(decoded.id);
        console.log('🔐 [AUTH] User found:', !!user, '| active:', user?.isActive);
        
        if (!user) return next(new Error('User not found'));
        if (!user.isActive) return next(new Error('Account deactivated'));
        
        if (user.currentSessionToken && user.currentSessionToken !== token) {
          console.log('❌ [AUTH] Session mismatch!');
          return next(new Error('Logged in on another device'));
        }
        
        socket.userId = user._id.toString();
        socket.username = user.username || 'player';
        
        await User.findByIdAndUpdate(user._id, { 
          currentSocketId: socket.id, 
          lastActive: new Date() 
        });
        
        console.log('✅ [AUTH] Success:', socket.username);
        next();
      } catch (e) { 
        console.log('❌ [AUTH] Unexpected error:', e.message);
        next(new Error('Invalid token')); 
      }
    });

    this.io.on('connection', (socket) => {
      console.log('🟢 Connected:', socket.username, socket.id);
      this.engine.setUserSocket(socket.userId, socket.id);

      // ========================
      // ROOM MANAGEMENT
      // ========================
      socket.on('joinRoom', async (roomId) => {
        if (!roomId) return;
        
        console.log(`📍 [ROOM] ${socket.username} requesting join: ${roomId}`);
        
        // Leave all previous rooms
        const rooms = Array.from(socket.rooms);
        rooms.forEach(room => {
          if (room !== socket.id) {
            socket.leave(room);
            console.log(`🚪 ${socket.username} left room: ${room}`);
          }
        });
        
        // Join new room
        socket.join(roomId);
        console.log(`📍 ${socket.username} joined room: ${roomId}`);
        
        // Send game state for fast_bingo
        if (roomId === 'fast_bingo') {
          try {
            const state = await this.engine.getGameState(roomId, socket.userId);
            socket.emit('gameState', state);
          } catch (e) {
            console.error('❌ [ROOM] Error getting fast bingo state:', e.message);
          }
        }

        // Send game state for main-bingo-room
        if (roomId === 'main-bingo-room') {
          try {
            const mainBingoCtrl = require('../controllers/mainBingoController');
            const state = await mainBingoCtrl.getStateForSocket(socket.userId);
            socket.emit('gameState', state);
          } catch (e) {
            console.error('❌ [ROOM] Error getting main bingo state:', e.message);
            socket.emit('gameState', { active: false, message: 'Error loading game' });
          }
        }
      });

      socket.on('leaveRoom', (roomId) => {
        if (roomId) {
          socket.leave(roomId);
          console.log(`🚪 ${socket.username} left room: ${roomId}`);
        }
      });

      // ========================
      // MAIN BINGO - Pick Cards
      // ========================
            socket.on('mainBingoPickCards', async (data, callback) => {
        const { quantity } = data;
        console.log(`🎫 [PICK] ${socket.username} picking ${quantity} cards`);
        
        try {
          const MainBingoGame = require('../models/MainBingoGame');
          const MainBingoConfig = require('../models/MainBingoConfig');
          const Card = require('../models/Card');
          
          const game = await MainBingoGame.getActiveGame();
          if (!game || (game.status !== 'setup' && game.status !== 'countdown')) {
            return callback({ status: 'error', message: 'Game not available' });
          }
          
          const config = await MainBingoConfig.findById(game.configId);
          const totalPlayerCards = await Card.countDocuments({ 
            gameId: game._id, userId: socket.userId 
          });
          const maxAllowed = config.maxCardsPerPlayer - totalPlayerCards;
          
          if (maxAllowed <= 0) {
            return callback({ status: 'error', message: 'Max cards reached' });
          }
          
          const actualQty = Math.min(quantity, maxAllowed);
          
          // 🔥 Try pool first
                    // 🔥 FAVORITE CARTELAS FIRST
          const User = require('../models/User');
          const user = await User.findById(socket.userId);
          const favoriteDisplayIds = (user.favoriteCartelas || []).map(f => f.displayId);
          
          let availableCards = [];
          const existingIds = [];
          
          if (favoriteDisplayIds.length > 0) {
            const favoriteCards = await Card.find({
              displayId: { $in: favoriteDisplayIds },
              gameId: null,
              userId: null,
              status: 'preview'
            }).limit(actualQty);
            
            if (favoriteCards.length > 0) {
              availableCards = favoriteCards;
              existingIds.push(...favoriteCards.map(c => c._id));
              console.log(`⭐ ${favoriteCards.length} favorite cartelas found for ${socket.username}`);
            }
          }
          
          // If favorites don't fill the quantity, get random from pool
          if (availableCards.length < actualQty) {
            const remaining = actualQty - availableCards.length;
            const randomCards = await Card.aggregate([
              { $match: { gameId: null, userId: null, status: 'preview', _id: { $nin: existingIds } } },
              { $sample: { size: remaining } }
            ]);
            availableCards = [...availableCards, ...randomCards];
          }
          
          // 🔥 If pool is empty, raid unregistered preview cards from other users
                    // 🔥 If pool is empty, raid unregistered preview cards from other users
          if (availableCards.length === 0) {
            console.log('🔄 Pool empty! Raiding...');
            
            availableCards = await Card.aggregate([
              { 
                $match: { 
                  gameId: game._id, 
                  status: 'preview',
                  userId: { $ne: socket.userId },
                  _id: { $nin: existingIds }
                } 
              },
              { $sample: { size: actualQty } }
            ]);
            
            if (availableCards.length > 0) {
              // Notify original owners that their cards are being raided
              const raidedUserIds = [...new Set(availableCards.map(c => c.userId.toString()))];
              for (const uid of raidedUserIds) {
                const userSocket = this.engine.getUserSocket(uid);
                if (userSocket) {
                  this.io.to(userSocket).emit('cardsRaided', {
                    message: 'Your unregistered preview cards are available for others to claim! Register now!',
                    count: availableCards.filter(c => c.userId.toString() === uid).length
                  });
                }
              }
              
              console.log(`🔄 Raided ${availableCards.length} cards from ${raidedUserIds.length} users`);
            }
          }
          
          if (availableCards.length === 0) {
            return callback({ status: 'error', message: 'No cards available. All preview cards are registered.' });
          }
          
          // Assign cards to requesting player
          const cardIds = availableCards.map(c => c._id);
          await Card.updateMany(
            { _id: { $in: cardIds } },
            { $set: { gameId: game._id, userId: socket.userId, status: 'preview' } }
          );
          
          const cards = await Card.find({ _id: { $in: cardIds } });
          
          // Update game players list
          const player = game.players.find(p => p.userId.toString() === socket.userId);
          if (!player) {
            game.players.push({ userId: socket.userId, cards: cardIds });
          } else {
            player.cards.push(...cardIds);
          }
          await game.save();
          
          callback({ 
            status: 'ok', 
            cards: cards,
            cardsOwned: totalPlayerCards + cards.length,
            raided: availableCards.length > 0 && availableCards[0].gameId !== null
          });
          
          console.log(`✅ [PICK] ${cards.length} cards assigned to ${socket.username}`);
          
        } catch (e) {
          console.error('❌ [PICK] Error:', e.message);
          callback({ status: 'error', message: e.message });
        }
      });

      // ========================
      // MAIN BINGO - Register Cards (atomic, no duplicates)
      // ========================
           // ========================
      // MAIN BINGO - Register Cards (atomic, no duplicates + spending limits)
      // ========================
      socket.on('mainBingoRegisterCards', async (data, callback) => {
        const { cardIds } = data;
        console.log(`💳 [REGISTER] ${socket.username} registering ${cardIds?.length} cards`);
        
        try {
          const MainBingoGame = require('../models/MainBingoGame');
          const MainBingoConfig = require('../models/MainBingoConfig');
          const Card = require('../models/Card');
          const User = require('../models/User');
          const Notification = require('../models/Notification');
          
          const game = await MainBingoGame.getActiveGame();
          if (!game || (game.status !== 'setup' && game.status !== 'countdown')) {
            return callback({ status: 'error', message: 'Game not accepting registrations' });
          }
          
          const config = await MainBingoConfig.findById(game.configId);
          const user = await User.findById(socket.userId);
          
          const totalCost = config.cardPrice * cardIds.length;
          
          // 🔥 CHECK SPENDING LIMITS
          const limits = user.spendingLimits || {};
          const usage = user.spendingUsage || {};
          const now = new Date();
          const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          
          // Reset daily
          if (!usage.dailyReset || now > new Date(usage.dailyReset)) {
            usage.daily = 0;
            usage.dailyReset = new Date(today.getTime() + 24*60*60*1000);
          }
          // Reset weekly
          const weekStart = new Date(today);
          weekStart.setDate(today.getDate() - today.getDay());
          if (!usage.weeklyReset || now > new Date(usage.weeklyReset)) {
            usage.weekly = 0;
            usage.weeklyReset = new Date(weekStart.getTime() + 7*24*60*60*1000);
          }
          // Reset monthly
          if (!usage.monthlyReset || now > new Date(usage.monthlyReset)) {
            usage.monthly = 0;
            usage.monthlyReset = new Date(now.getFullYear(), now.getMonth()+1, 1);
          }
          
          if (limits.enabled) {
            if (limits.daily > 0 && (usage.daily + totalCost) > limits.daily) {
              return callback({ status: 'error', message: `Daily spending limit reached (${limits.daily} ETB)` });
            }
            if (limits.weekly > 0 && (usage.weekly + totalCost) > limits.weekly) {
              return callback({ status: 'error', message: `Weekly spending limit reached (${limits.weekly} ETB)` });
            }
            if (limits.monthly > 0 && (usage.monthly + totalCost) > limits.monthly) {
              return callback({ status: 'error', message: `Monthly spending limit reached (${limits.monthly} ETB)` });
            }
          }
          
          // Check balance
          if ((user.walletBalance || user.balance || 0) < totalCost) {
            return callback({ status: 'error', message: 'Insufficient balance' });
          }
          
          // Atomic update: only register cards still in 'preview' status
          const result = await Card.updateMany(
            { _id: { $in: cardIds }, userId: socket.userId, gameId: game._id, status: 'preview' },
            { $set: { status: 'registered' } }
          );
          
          if (result.modifiedCount !== cardIds.length) {
            return callback({ 
              status: 'error', 
              message: `Only ${result.modifiedCount}/${cardIds.length} registered. Some may already be taken.` 
            });
          }
          
          // Deduct balance
          if (user.walletBalance !== undefined) {
            user.walletBalance -= totalCost;
          } else {
            user.balance -= totalCost;
          }
          
          // Update spending usage
          if (limits.enabled) {
            usage.daily += totalCost;
            usage.weekly += totalCost;
            usage.monthly += totalCost;
            user.spendingUsage = usage;
            
            // 🔥 NOTIFY if near limit (80%)
            if (limits.daily > 0 && usage.daily >= limits.daily * 0.8) {
              await Notification.create({
                user: socket.userId,
                type: 'limit_warning',
                title: '⚠️ Daily Limit Warning',
                message: `You've used ${usage.daily}/${limits.daily} ETB today`,
              });
            }
            if (limits.weekly > 0 && usage.weekly >= limits.weekly * 0.8) {
              await Notification.create({
                user: socket.userId,
                type: 'limit_warning',
                title: '⚠️ Weekly Limit Warning',
                message: `You've used ${usage.weekly}/${limits.weekly} ETB this week`,
              });
            }
            if (limits.monthly > 0 && usage.monthly >= limits.monthly * 0.8) {
              await Notification.create({
                user: socket.userId,
                type: 'limit_warning',
                title: '⚠️ Monthly Limit Warning',
                message: `You've used ${usage.monthly}/${limits.monthly} ETB this month`,
              });
            }
          }
          
          await user.save();
          
          game.totalCards = (game.totalCards || 0) + cardIds.length;
          await game.save();
          
          const newBalance = user.walletBalance || user.balance;
          
          callback({ status: 'ok', registeredCount: cardIds.length, newBalance });
          console.log(`✅ [REGISTER] ${socket.username} registered ${cardIds.length} cards. Balance: ${newBalance}`);
          
        } catch (e) {
          console.error('❌ [REGISTER] Error:', e.message);
          callback({ status: 'error', message: e.message });
        }
      });

      // ========================
      // MAIN BINGO - Call BINGO
      // ========================
     socket.on('mainBingoCallBingo', async (data) => {
    const { roomId, cardId } = data;
    console.log(`🎯 [MAIN BINGO] ${socket.username} calling BINGO on card ${cardId}`);
    
    try {
      const result = await this.mainEngine.callBingo(socket.userId, cardId);
      
      if (result.success) {
        socket.emit('mainBingoBingoAccepted', result);
      } else {
        socket.emit('mainBingoBingoRejected', result);
      }
    } catch (e) {
      console.error('❌ [MAIN BINGO] Error:', e.message);
      socket.emit('mainBingoBingoError', { message: e.message });
    }
});

      // ========================
      // MAIN BINGO - Mark Number
      // ========================
      socket.on('markNumber', async (data) => {
        try {
          const Card = require('../models/Card');
          const card = await Card.findOne({ _id: data.cardId, userId: socket.userId });
          if (card && !card.isBlocked) {
            const cell = card.grid[data.letter]?.find(c => c.number === data.number);
            if (cell) {
              cell.isMarked = !cell.isMarked;
              await card.save();
            }
            socket.emit('mainBingoNumberMarked', { cardId: data.cardId, grid: card.grid });
          }
        } catch (e) {
          socket.emit('mainBingoError', { message: e.message });
        }
      });

      // ========================
      // FAST BINGO EVENTS
      // ========================
      // ========================
// FAST BINGO EVENTS
// ========================

// 🔥 BUY CARD - Full implementation


      socket.on('callBingo', async (data) => {
        try {
          const { roomId, cardId } = data;
          const result = await this.engine.bingo.callBingo(roomId, socket.userId, cardId);
          if (result.success) {
            this.io.to(roomId).emit('bingoAccepted', result);
          } else {
            socket.emit('bingoRejected', result);
          }
        } catch (e) {
          socket.emit('bingoError', { message: e.message });
        }
      });

      socket.on('previewCard', async (roomId) => {
        try {
          await this.engine.cards.previewCard(roomId, socket.userId);
        } catch (e) {
          socket.emit('error', { message: e.message });
        }
      });

      socket.on('registerCard', async (data, callback) => {
        const { roomId, cardId } = data;
        try {
          const result = await this.engine.cards.registerCard(roomId, socket.userId, cardId, callback);
          if (!callback) {
            socket.emit('cardRegistered', {
              status: 'ok',
              cardId: result.cardId,
              cardNumber: result.cardNumber,
              newBalance: result.newBalance
            });
          }
        } catch (e) {
          if (typeof callback === 'function') {
            callback({ status: 'error', message: e.message });
          } else {
            socket.emit('cardPurchaseError', { message: e.message });
          }
        }
      });

      socket.on('cancelPreviewCard', async ({ roomId, cardId }) => {
        try {
          await this.engine.cards.cancelPreviewCard(roomId, socket.userId, cardId);
        } catch (e) {
          socket.emit('error', { message: e.message });
        }
      });

      socket.on('previewCards', async (data) => {
        try {
          await this.engine.cards.previewCards(data.roomId, socket.userId, data.quantity);
        } catch (e) {
          socket.emit('error', { message: e.message });
        }
      });

      // ========================
      // AUTO-MARK
      // ========================
      socket.on('toggleAutoMark', (data) => {
        if (data.enabled) {
          this.autoMarkUsers.set(socket.userId, true);
        } else {
          this.autoMarkUsers.delete(socket.userId);
        }
        socket.emit('autoMarkUpdated', { enabled: data.enabled });
        if (data.enabled) this.markPastNumbers(socket.userId, socket);
      });

      // ========================
      // DISCONNECT
      // ========================
      socket.on('disconnect', async () => {
        console.log('🔴 Disconnected:', socket.username, socket.id);
        this.autoMarkUsers.delete(socket.userId);
        this.engine.removeUserSocket(socket.userId);
        
        setTimeout(async () => {
          const user = await User.findById(socket.userId);
          if (user && user.currentSocketId === socket.id) {
            await User.findByIdAndUpdate(socket.userId, { currentSocketId: null });
          }
        }, 30000);
      });
    });
  }

  emitToRoom(roomId, event, data) {
    this.io.to(roomId).emit(event, data);
  }

  emitToUser(userId, event, data) {
    const socketId = this.engine.getUserSocket(userId);
    if (socketId) this.io.to(socketId).emit(event, data);
  }

  async markPastNumbers(userId, socket) {
    try {
      const activeGame = await Game.getActiveGame('fast_bingo');
      if (!activeGame || !activeGame.drawnNumbers || activeGame.drawnNumbers.length === 0) return;
      
      const cards = await Card.find({ gameId: activeGame._id, userId, isBlocked: false, bingoCalled: false });
      let markedCount = 0;
      
      for (const card of cards) {
        for (const dn of activeGame.drawnNumbers) {
          const col = card.grid[dn.letter];
          if (col) {
            const cell = col.find(c => c.number === dn.number);
            if (cell && !cell.isMarked) { cell.isMarked = true; markedCount++; }
          }
        }
        if (markedCount > 0) await card.save();
      }
      
      if (markedCount > 0) {
        socket.emit('pastNumbersMarked', { count: markedCount });
        const updatedCards = await Card.find({ gameId: activeGame._id, userId });
        socket.emit('cardsUpdated', { cards: updatedCards });
      }
    } catch (e) {
      console.error('markPastNumbers error:', e);
    }
  }
}

module.exports = GameSocket;