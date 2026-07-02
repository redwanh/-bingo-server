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
    // 🔥 Auth middleware with debug
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
          console.log('🔐 [AUTH] Token valid, user:', decoded.id, 'expires:', new Date(decoded.exp * 1000).toISOString());
        } catch (jwtError) {
          console.log('❌ [AUTH] JWT verify failed:', jwtError.message);
          return next(new Error('Invalid token'));
        }
        
        const user = await User.findById(decoded.id);
        console.log('🔐 [AUTH] User found:', !!user, '| active:', user?.isActive);
        
        if (!user) {
          console.log('❌ [AUTH] User not found in DB');
          return next(new Error('User not found'));
        }
        
        if (!user.isActive) {
          console.log('❌ [AUTH] Account deactivated');
          return next(new Error('Account deactivated'));
        }
        
        if (user.currentSessionToken && user.currentSessionToken !== token) {
          console.log('❌ [AUTH] Session mismatch!');
          console.log('   Stored:', user.currentSessionToken?.substring(0, 30) + '...');
          console.log('   Received:', token?.substring(0, 30) + '...');
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
        
        // Only send game state for fast_bingo rooms
        if (roomId === 'fast_bingo') {
          try {
            console.log(`📊 [ROOM] Fetching game state for ${socket.username}`);
            const state = await this.engine.getGameState(roomId, socket.userId);
            console.log(`📊 [ROOM] Game state found:`, state ? `Game #${state.gameNumber} (${state.status})` : 'NULL');
            socket.emit('gameState', state);
          } catch (e) {
            console.error('❌ [ROOM] Error getting game state:', e.message);
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
      // FAST BINGO EVENTS
      // ========================
      
      socket.on('buyCard', async (roomId) => {
        try {
          const result = await this.engine.cards.buyCard(roomId, socket.userId);
          socket.emit('buySuccess', result);
        } catch (e) {
          socket.emit('buyError', { message: e.message });
        }
      });

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

      socket.on('registerCard', async ({ roomId, cardId }) => {
        try {
          await this.engine.cards.registerCard(roomId, socket.userId, cardId);
        } catch (e) {
          socket.emit('error', { message: e.message });
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
        console.log('🟡 [SOCKET] previewCards BATCH:', data);
        try {
          const result = await this.engine.cards.previewCards(data.roomId, socket.userId, data.quantity);
          console.log('🟡 [SOCKET] previewCards done:', result);
        } catch (e) {
          console.log('🟡 [SOCKET] previewCards error:', e.message);
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