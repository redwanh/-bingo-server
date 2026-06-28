const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Card = require('../models/Card');
const Game = require('../models/Game');

class GameSocket {
  constructor(io, engine) {
    this.io = io;
    this.engine = engine;
    this.autoMarkUsers = new Map();
  }

  initialize() {
    // 🔥 Auth middleware
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        if (!token) return next(new Error('Auth required'));
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id);
        if (!user) return next(new Error('User not found'));
        if (!user.isActive) return next(new Error('Account deactivated'));
        if (user.currentSessionToken && user.currentSessionToken !== token) {
          return next(new Error('Logged in on another device'));
        }
        socket.userId = user._id.toString();
        socket.username = user.username || 'player';
        await User.findByIdAndUpdate(user._id, { 
          currentSocketId: socket.id, 
          lastActive: new Date() 
        });
        next();
      } catch (e) { 
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
        
        // Leave all previous rooms first
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
        
        // Send game state for this room
        try {
          const state = await this.engine.getGameState(roomId, socket.userId);
          socket.emit('gameState', state);
        } catch (e) {
          console.error('Error getting game state:', e);
        }
      });

      socket.on('leaveRoom', (roomId) => {
        if (roomId) {
          socket.leave(roomId);
          console.log(`🚪 ${socket.username} left room: ${roomId}`);
        }
      });

      // ========================
      // MAIN BINGO EVENTS (room-specific)
      // ========================
      
      // 🔥 MainBingo: Call Bingo
      socket.on('mainBingoCallBingo', async (data) => {
        try {
          const { roomId, cardId } = data;
          console.log(`🎯 BINGO called in room ${roomId} by ${socket.username}`);
          const result = await this.engine.callBingo(socket.userId, cardId);
          
          // Emit result only to the specific room
          if (result.success) {
            this.io.to(roomId).emit('mainBingoBingoAccepted', result);
            this.io.to(roomId).emit('mainBingoFirstBingo', result);
          } else {
            socket.emit('mainBingoBingoRejected', result);
            if (result.reason === 'no_win' || result.reason === 'last_number_not_on_card') {
              this.io.to(roomId).emit('mainBingoFalseBingo', {
                userId: socket.userId,
                cardId: cardId,
                reason: result.reason
              });
            }
          }
        } catch (e) {
          socket.emit('mainBingoBingoError', { message: e.message });
        }
      });

      // 🔥 MainBingo: Mark Number
      socket.on('markNumber', async (data) => {
        try {
          const { cardId, number, letter } = data;
          const card = await Card.findOne({ _id: cardId, userId: socket.userId });
          if (card && !card.isBlocked) {
            const cell = card.grid[letter]?.find(c => c.number === number);
            if (cell) {
              cell.isMarked = !cell.isMarked;
              await card.save();
            }
            socket.emit('numberMarked', { cardId, grid: card.grid });
          }
        } catch (e) {
          console.error('markNumber error:', e);
        }
      });

      // ========================
      // FAST BINGO EVENTS (room-specific)
      // ========================
      
      socket.on('buyCard', async (roomId) => {
        try {
          const result = await this.engine.buyCard(roomId, socket.userId);
          socket.emit('buySuccess', result);
        } catch (e) {
          socket.emit('buyError', { message: e.message });
        }
      });

      socket.on('callBingo', async (data) => {
        try {
          const { roomId, cardId } = data;
          const result = await this.engine.callBingo(roomId, socket.userId, cardId);
          
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
          await this.engine.previewCard(roomId, socket.userId);
        } catch (e) {
          socket.emit('error', { message: e.message });
        }
      });

      socket.on('registerCard', async ({ roomId, cardId }) => {
        try {
          await this.engine.registerCard(roomId, socket.userId, cardId);
        } catch (e) {
          socket.emit('error', { message: e.message });
        }
      });

      socket.on('cancelPreviewCard', async ({ roomId, cardId }) => {
        try {
          await this.engine.cancelPreviewCard(roomId, socket.userId, cardId);
        } catch (e) {
          socket.emit('error', { message: e.message });
        }
      });

      // ========================
      // AUTO-MARK (per user)
      // ========================
      socket.on('toggleAutoMark', (data) => {
        if (data.enabled) {
          this.autoMarkUsers.set(socket.userId, true);
        } else {
          this.autoMarkUsers.delete(socket.userId);
        }
        socket.emit('autoMarkUpdated', { enabled: data.enabled });
        
        if (data.enabled) {
          this.markPastNumbers(socket.userId, socket);
        }
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
            await User.findByIdAndUpdate(socket.userId, { 
              currentSocketId: null 
            });
          }
        }, 30000);
      });
    });
  }

  // 🔥 Emit to specific room helper
  emitToRoom(roomId, event, data) {
    this.io.to(roomId).emit(event, data);
  }

  // 🔥 Emit to specific user
  emitToUser(userId, event, data) {
    const socketId = this.engine.getUserSocket(userId);
    if (socketId) {
      this.io.to(socketId).emit(event, data);
    }
  }

  async markPastNumbers(userId, socket) {
    try {
      const activeGame = await Game.getActiveGame('fast_bingo');
      if (!activeGame || !activeGame.drawnNumbers || activeGame.drawnNumbers.length === 0) return;
      
      const cards = await Card.find({ 
        gameId: activeGame._id, 
        userId, 
        isBlocked: false, 
        bingoCalled: false 
      });
      
      let markedCount = 0;
      
      for (const card of cards) {
        for (const dn of activeGame.drawnNumbers) {
          const col = card.grid[dn.letter];
          if (col) {
            const cell = col.find(c => c.number === dn.number);
            if (cell && !cell.isMarked) {
              cell.isMarked = true;
              markedCount++;
            }
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

function genCol(min, max) {
  const s = new Set();
  while (s.size < 5) {
    s.add(Math.floor(Math.random() * (max - min + 1)) + min);
  }
  return Array.from(s).map(n => ({ number: n, isMarked: false }));
}

module.exports = GameSocket;