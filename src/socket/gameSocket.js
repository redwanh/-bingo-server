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
        await User.findByIdAndUpdate(user._id, { currentSocketId: socket.id, lastActive: new Date() });
        next();
      } catch (e) { next(new Error('Invalid token')); }
    });

    this.io.on('connection', (socket) => {
      console.log('Connected:', socket.username);
      this.engine.setUserSocket(socket.userId, socket.id);

      socket.on('joinRoom', async (roomId) => {
        socket.join(roomId);
        const state = await this.engine.getGameState(roomId, socket.userId);
        socket.emit('gameState', state);
      });
        // Preview card
  socket.on('previewCard', async (roomId) => {
    try {
      await this.engine.previewCard(roomId, socket.userId);
    } catch (e) {
      socket.emit('error', { message: e.message });
    }
  });

  // Register card
  socket.on('registerCard', async ({ roomId, cardId }) => {
    try {
      await this.engine.registerCard(roomId, socket.userId, cardId);
    } catch (e) {
      socket.emit('error', { message: e.message });
    }
  });

  // Cancel preview
  socket.on('cancelPreviewCard', async ({ roomId, cardId }) => {
    try {
      await this.engine.cancelPreviewCard(roomId, socket.userId, cardId);
    } catch (e) {
      socket.emit('error', { message: e.message });
    }
  });

      socket.on('buyCard', async (roomId) => {
        try {
          const result = await this.engine.buyCard(roomId, socket.userId);
          socket.emit('buySuccess', result);
        } catch (e) { socket.emit('buyError', { message: e.message }); }
      });

      socket.on('markNumber', async (data) => {
        const card = await Card.findOne({ _id: data.cardId, userId: socket.userId });
        if (card && !card.isBlocked) {
          const cell = card.grid[data.letter]?.find(c => c.number === data.number);
          if (cell) { cell.isMarked = !cell.isMarked; await card.save(); }
          socket.emit('numberMarked', { cardId: data.cardId, grid: card.grid });
        }
      });

      socket.on('callBingo', async (data) => {
        try {
          const result = await this.engine.callBingo(data.roomId, socket.userId, data.cardId);
          socket.emit(result.success ? 'bingoAccepted' : 'bingoRejected', result);
        } catch (e) { socket.emit('bingoError', { message: e.message }); }
      });

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

      socket.on('disconnect', async () => {
        console.log('Disconnected:', socket.username);
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
    } catch (e) { console.error('markPastNumbers error:', e); }
  }
}

function genCol(min,max){const s=new Set();while(s.size<5)s.add(Math.floor(Math.random()*(max-min+1))+min);return Array.from(s).map(n=>({number:n,isMarked:false}));}
module.exports = GameSocket;










