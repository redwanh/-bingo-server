// ============================================================
// server/src/socket/FB_fastBingoSocket.js
// Fast Bingo Socket Handler - NEW clean implementation
// Completely separate from old gameSocket.js
// All events prefixed with 'fb_' to avoid conflicts
// ============================================================

const jwt = require('jsonwebtoken');
const User = require('../models/User');

class FB_FastBingoSocket {
  /**
   * @param {SocketIO.Server} io - Socket.io server instance
   * @param {FB_FastBingoEngine} engine - Fast Bingo engine (NEW)
   */
  constructor(io, engine) {
    this.io = io;
    this.engine = engine;
    this.roomId = 'fb_fast_bingo';
  }

  initialize() {
    // We DON'T add another io.use() middleware here because
    // gameSocket.js already has auth middleware that runs first.
    // The socket.userId is already set when it reaches our handlers.

    this.io.on('connection', (socket) => {
      // Only handle events for fb_fast_bingo room
      this._registerHandlers(socket);
    });

    console.log('✅ FB_FastBingoSocket initialized');
  }

  // ==========================================
  // ALL EVENT HANDLERS
  // ==========================================

  _registerHandlers(socket) {

    // ─── JOIN ROOM ───────────────────────────
    socket.on('fb_joinRoom', async (roomId) => {
      if (roomId !== this.roomId) return; // Only handle fb_fast_bingo

      // Leave all other rooms first
      Array.from(socket.rooms).forEach(room => {
        if (room !== socket.id) socket.leave(room);
      });

      socket.join(this.roomId);
      console.log(`📍 FB: ${socket.username} joined ${this.roomId}`);

      // Send current game state
      try {
        const state = await this.engine.getGameState(this.roomId, socket.userId);
        socket.emit('fb_gameState', state);
      } catch (e) {
        console.error('FB: Error getting game state:', e.message);
        socket.emit('fb_error', { message: 'Failed to load game' });
      }
    });

    // ─── LEAVE ROOM ──────────────────────────
    socket.on('fb_leaveRoom', (roomId) => {
      if (roomId === this.roomId) {
        socket.leave(this.roomId);
        console.log(`🚪 FB: ${socket.username} left ${this.roomId}`);
      }
    });

    // ─── BUY CARD ────────────────────────────
    socket.on('fb_buyCard', async (data, callback) => {
  console.log('🔵🔵🔵 FB SOCKET RECEIVED fb_buyCard:', data);
  console.log('🔵 socket.userId:', socket.userId);
  console.log('🔵 this.roomId:', this.roomId);
      try {
        const { cardId } = data;
        console.log(`🛒 FB: ${socket.username} buying card ${cardId}`);

        const result = await this.engine.purchaseCard(
          this.roomId,
          socket.userId,
          cardId
        );

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

    // ─── CALL BINGO (Manual button press) ─────
    socket.on('fb_callBingo', async (data, callback) => {
      try {
        const { cardId } = data;
        console.log(`🎯 FB: ${socket.username} calling BINGO on card ${cardId}`);

        const result = await this.engine.callBingo(
          this.roomId,
          socket.userId,
          cardId
        );

        if (typeof callback === 'function') {
          callback(result);
        }
      } catch (e) {
        console.error('FB: Call bingo error:', e.message);
        if (typeof callback === 'function') {
          callback({ success: false, error: e.message });
        }
      }
    });

    // ─── DISCONNECT ───────────────────────────
    socket.on('disconnect', () => {
      console.log(`🔴 FB: ${socket.username} disconnected`);
      this.engine.removeUserSocket(socket.userId);
    });
  }
}

module.exports = FB_FastBingoSocket;