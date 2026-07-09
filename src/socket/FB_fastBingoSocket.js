// ============================================================
// server/src/socket/FB_fastBingoSocket.js
// PRODUCTION-READY Fast Bingo Socket Handler
// ============================================================

class FB_FastBingoSocket {
  constructor(io, engine) {
    this.io = io;
    this.engine = engine;
    this.roomId = 'fb_fast_bingo';
  }

  initialize() {
    this.io.on('connection', (socket) => {
      this._registerHandlers(socket);
    });
    console.log('✅ FB_FastBingoSocket initialized');
  }

  _registerHandlers(socket) {
    // ─── JOIN ROOM ───────────────────────────
    socket.on('fb_joinRoom', async (roomId) => {
      if (roomId !== this.roomId) return;
      
      Array.from(socket.rooms).forEach(room => {
        if (room !== socket.id) socket.leave(room);
      });
      
      socket.join(this.roomId);
      console.log(`📍 FB: ${socket.username || 'player'} joined ${this.roomId}`);

      try {
        const state = await this.engine.getGameState(this.roomId, socket.userId);
        socket.emit('fb_gameState', state);
      } catch (e) {
        console.error('FB: Error getting game state:', e.message);
        socket.emit('fb_error', { message: 'Failed to load game' });
      }
    });

    // ─── BUY CARD (Production) ───────────────
    socket.on('fb_buyCard', async (data, callback) => {
      if (!socket.userId) {
        if (typeof callback === 'function') {
          callback({ success: false, error: 'Please log in again.' });
        }
        return;
      }

      try {
        const { cardId } = data;
        const result = await this.engine.purchaseCard(this.roomId, socket.userId, cardId);

        if (typeof callback === 'function') {
          callback({ success: true, ...result });
        }
      } catch (e) {
        console.error('FB: Buy card error:', e.message);
        if (typeof callback === 'function') {
          callback({ success: false, error: e.message });
        }
      }
    });

    // ─── CALL BINGO ──────────────────────────
    socket.on('fb_callBingo', async (data, callback) => {
      try {
        const { cardId } = data;
        const result = await this.engine.callBingo(this.roomId, socket.userId, cardId);
        if (typeof callback === 'function') callback(result);
      } catch (e) {
        console.error('FB: Call bingo error:', e.message);
        if (typeof callback === 'function') callback({ success: false, error: e.message });
      }
    });

    // ─── DISCONNECT ───────────────────────────
    socket.on('disconnect', () => {
      this.engine.removeUserSocket(socket.userId);
    });
  }
}

module.exports = FB_FastBingoSocket;