class BingoService {
  constructor(engine) { this.engine = engine; }

  checkWin(card, drawnNumbers, config) {
    const drawnSet = new Set(drawnNumbers.map(d => d.number));
    const cols = ['B', 'I', 'N', 'G', 'O'];
    
    if (config?.isLastNumberCalledBingo && drawnNumbers.length > 0) {
      const lastCalled = drawnNumbers[drawnNumbers.length - 1];
      const lastCell = card.grid[lastCalled.letter]?.find(c => c.number === lastCalled.number);
      if (!lastCell) return null;
    }
    
    for (let r = 0; r < 5; r++) {
      let ok = true;
      for (let c of cols) { if (!(c === 'N' && r === 2) && !drawnSet.has(card.grid[c][r].number)) { ok = false; break; } }
      if (ok) return 'line';
    }
    
    for (let c of cols) {
      let ok = true;
      for (let r = 0; r < 5; r++) { if (!(c === 'N' && r === 2) && !drawnSet.has(card.grid[c][r].number)) { ok = false; break; } }
      if (ok) return 'line';
    }
    
    let d1 = true, d2 = true;
    for (let i = 0; i < 5; i++) {
      if (!(cols[i] === 'N' && i === 2) && !drawnSet.has(card.grid[cols[i]][i].number)) d1 = false;
      if (!(cols[4 - i] === 'N' && i === 2) && !drawnSet.has(card.grid[cols[4 - i]][i].number)) d2 = false;
    }
    if (d1 || d2) return 'line';
    
    if (drawnSet.has(card.grid.B[0].number) && drawnSet.has(card.grid.O[0].number) && drawnSet.has(card.grid.B[4].number) && drawnSet.has(card.grid.O[4].number)) return 'four_corners';
    
    return null;
  }

  async callBingo(roomId, userId, cardId) {
    const Game = require('../../models/Game');
    const GameConfig = require('../../models/GameConfig');
    const Card = require('../../models/Card');
    const timerManager = require('../../utils/TimerManager');
    
    const game = await Game.getActiveGame(roomId);
    if (!game || (game.status !== 'in_progress' && game.status !== 'bingo_called')) throw new Error('Game not in progress');
    
    const card = await Card.findOne({ _id: cardId, userId, gameId: game._id, status: 'registered' });
    if (!card || card.isBlocked) throw new Error('Card not valid');
    if (card.bingoCalled) throw new Error('Bingo already called');
    
    const config = await GameConfig.findOne({ roomId });
    const lastCalled = game.drawnNumbers?.[game.drawnNumbers.length - 1];
    
    if (config?.isLastNumberCalledBingo && lastCalled) {
      const lastCell = card.grid[lastCalled.letter]?.find(c => c.number === lastCalled.number);
      if (!lastCell) {
        card.isBlocked = true; card.blockReason = 'Last number not on card'; await card.save();
        this.engine.io.to(roomId).emit('falseBingo', { userId, cardId, cardNumber: card.cardNumber, reason: `Last number not on card` });
        return { success: false, falseBingo: true };
      }
    }
    
    const winType = this.checkWin(card, game.drawnNumbers, config);
    if (!winType) {
      card.isBlocked = true; card.blockReason = 'no_win'; await card.save();
      this.engine.io.to(roomId).emit('falseBingo', { userId, cardId, cardNumber: card.cardNumber, reason: 'no_win' });
      return { success: false, falseBingo: true };
    }
    
    const drawnSet = new Set(game.drawnNumbers.map(d => d.number));
    for (let c of ['B', 'I', 'N', 'G', 'O']) {
      for (let cell of card.grid[c]) {
        if (drawnSet.has(cell.number) && !cell.isMarked && cell.number > 0) cell.isMarked = true;
      }
    }
    
    card.bingoCalled = true; card.bingoCallTime = new Date(); card.winType = winType; await card.save();
    
    if (game.status === 'in_progress') {
      timerManager.clearInterval(`draw_${roomId}`);
      game.status = 'bingo_called'; game.gracePeriodEndTime = new Date(Date.now() + 10000); await game.save();
      this.engine.io.to(roomId).emit('firstBingo', { userId, cardId, cardNumber: card.cardNumber, winType });
      timerManager.createTimeout(`grace_${roomId}`, () => this.engine.gameFlow.endGracePeriod(roomId, game._id), 10000, 'grace_period');
    } else {
      await game.save();
      this.engine.io.to(roomId).emit('additionalBingo', { userId, cardId, cardNumber: card.cardNumber, winType });
    }
    
    return { success: true, winType };
  }
}

module.exports = BingoService;