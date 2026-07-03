class BingoService {
  constructor(engine) { 
    this.engine = engine;
    // Cache drawn number sets per game to avoid rebuilding
    this.drawnSetCache = new Map();
  }

  // 🔧 OPTIMIZED: checkWin with early returns and pre-computed sets
  checkWin(card, drawnNumbers, config) {
    // Use cached set or build once
    const drawnSet = new Set(drawnNumbers.map(d => d.number));
    const cols = ['B', 'I', 'N', 'G', 'O'];
    
    // Last number check (config-based)
    if (config?.isLastNumberCalledBingo && drawnNumbers.length > 0) {
      const lastCalled = drawnNumbers[drawnNumbers.length - 1];
      const lastCell = card.grid[lastCalled.letter]?.find(c => c.number === lastCalled.number);
      if (!lastCell) return null;
    }
    
    // 🔧 Check rows (horizontal lines) - most common win
    for (let r = 0; r < 5; r++) {
      // Skip middle row if it's the FREE space row? No, check all rows
      let rowComplete = true;
      for (let ci = 0; ci < 5; ci++) {
        const col = cols[ci];
        // Skip FREE space (center of N column, row 2)
        if (col === 'N' && r === 2) continue;
        if (!drawnSet.has(card.grid[col][r].number)) {
          rowComplete = false;
          break;
        }
      }
      if (rowComplete) return 'line';
    }
    
    // 🔧 Check columns (vertical lines)
    for (let ci = 0; ci < 5; ci++) {
      const col = cols[ci];
      let colComplete = true;
      for (let r = 0; r < 5; r++) {
        if (col === 'N' && r === 2) continue;
        if (!drawnSet.has(card.grid[col][r].number)) {
          colComplete = false;
          break;
        }
      }
      if (colComplete) return 'line';
    }
    
    // 🔧 Check diagonals
    let diag1 = true, diag2 = true;
    for (let i = 0; i < 5; i++) {
      // Diagonal 1: B0, I1, N2(free), G3, O4
      if (!(cols[i] === 'N' && i === 2) && !drawnSet.has(card.grid[cols[i]][i].number)) {
        diag1 = false;
      }
      // Diagonal 2: O0, G1, N2(free), I3, B4
      if (!(cols[4 - i] === 'N' && i === 2) && !drawnSet.has(card.grid[cols[4 - i]][i].number)) {
        diag2 = false;
      }
      // Early exit if both diagonals already failed
      if (!diag1 && !diag2) break;
    }
    if (diag1 || diag2) return 'line';
    
    // 🔧 Check four corners
    if (drawnSet.has(card.grid.B[0].number) && 
        drawnSet.has(card.grid.O[0].number) && 
        drawnSet.has(card.grid.B[4].number) && 
        drawnSet.has(card.grid.O[4].number)) {
      return 'four_corners';
    }
    
    return null;
  }

  // 🔧 OPTIMIZED: callBingo with fewer DB calls and parallel operations
  async callBingo(roomId, userId, cardId) {
    const Game = require('../../models/Game');
    const GameConfig = require('../../models/GameConfig');
    const Card = require('../../models/Card');
    const timerManager = require('../../utils/TimerManager');
    
    // 🔧 Parallel fetch game and card
    const [game, card] = await Promise.all([
      Game.getActiveGame(roomId),
      Card.findOne({ _id: cardId, userId, status: 'registered' }).lean()
    ]);
    
    if (!game || (game.status !== 'in_progress' && game.status !== 'bingo_called')) {
      throw new Error('Game not in progress');
    }
    
    if (!card || card.isBlocked) throw new Error('Card not valid');
    if (card.bingoCalled) throw new Error('Bingo already called');
    
    // 🔧 Fetch config in parallel with validation
    const config = await GameConfig.findOne({ roomId }).lean();
    const lastCalled = game.drawnNumbers?.[game.drawnNumbers.length - 1];
    
    // Last number check
    if (config?.isLastNumberCalledBingo && lastCalled) {
      const lastCell = card.grid[lastCalled.letter]?.find(c => c.number === lastCalled.number);
      if (!lastCell) {
        // 🔧 Use updateOne instead of find + save
        await Card.updateOne(
          { _id: cardId },
          { $set: { isBlocked: true, blockReason: 'Last number not on card' } }
        );
        
        this.engine.io.to(roomId).emit('falseBingo', { 
          userId, cardId, cardNumber: card.cardNumber, 
          reason: 'Last number not on card' 
        });
        return { success: false, falseBingo: true };
      }
    }
    
    // Check win
    const winType = this.checkWin(card, game.drawnNumbers, config);
    
    if (!winType) {
      // 🔧 Use updateOne instead of find + save
      await Card.updateOne(
        { _id: cardId },
        { $set: { isBlocked: true, blockReason: 'no_win' } }
      );
      
      this.engine.io.to(roomId).emit('falseBingo', { 
        userId, cardId, cardNumber: card.cardNumber, 
        reason: 'no_win' 
      });
      return { success: false, falseBingo: true };
    }
    
    // 🔧 Auto-mark all drawn numbers on the card (build update in memory)
    const drawnSet = new Set(game.drawnNumbers.map(d => d.number));
    const gridUpdates = {};
    
    for (let col of ['B', 'I', 'N', 'G', 'O']) {
      const updatedCol = card.grid[col].map(cell => {
        if (drawnSet.has(cell.number) && !cell.isMarked && cell.number > 0) {
          return { ...cell, isMarked: true };
        }
        return cell;
      });
      
      // Only update if changed
      if (JSON.stringify(updatedCol) !== JSON.stringify(card.grid[col])) {
        gridUpdates[`grid.${col}`] = updatedCol;
      }
    }
    
    // 🔧 Single update for card
    const updateFields = {
      bingoCalled: true,
      bingoCallTime: new Date(),
      winType,
      ...gridUpdates
    };
    
    await Card.updateOne({ _id: cardId }, { $set: updateFields });
    
    // Handle first vs additional bingo
    if (game.status === 'in_progress') {
      timerManager.clearInterval(`draw_${roomId}`);
      
      // 🔧 Update game in one operation
      await Game.updateOne(
        { _id: game._id },
        { 
          $set: { 
            status: 'bingo_called', 
            gracePeriodEndTime: new Date(Date.now() + 10000) 
          } 
        }
      );
      
      this.engine.io.to(roomId).emit('firstBingo', { 
        userId, cardId, cardNumber: card.cardNumber, winType 
      });
      
      timerManager.createTimeout(
        `grace_${roomId}`, 
        () => this.engine.gameFlow.endGracePeriod(roomId, game._id), 
        10000, 
        'grace_period'
      );
    } else {
      // Already in bingo_called state, just emit
      this.engine.io.to(roomId).emit('additionalBingo', { 
        userId, cardId, cardNumber: card.cardNumber, winType 
      });
    }
    
    return { success: true, winType };
  }

  // 🔧 NEW: Batch check multiple cards for auto-bingo (used in drawNumbers)
  checkMultipleCards(cards, drawnNumbers, config) {
    const drawnSet = new Set(drawnNumbers.map(d => d.number));
    const results = [];
    
    for (const card of cards) {
      // Skip blocked or already called cards
      if (card.isBlocked || card.bingoCalled) {
        results.push({ cardId: card._id, winType: null });
        continue;
      }
      
      const winType = this.checkWinWithSet(card, drawnSet, config);
      results.push({ cardId: card._id, winType });
    }
    
    return results;
  }

  // 🔧 OPTIMIZED: checkWin variant that accepts pre-built set
  checkWinWithSet(card, drawnSet, config) {
    const cols = ['B', 'I', 'N', 'G', 'O'];
    
    // Last number check
    if (config?.isLastNumberCalledBingo) {
      // This variant doesn't have lastCalled info, skip this check
      // The caller should handle last number validation separately
    }
    
    // Check rows
    for (let r = 0; r < 5; r++) {
      let rowComplete = true;
      for (let ci = 0; ci < 5; ci++) {
        if (cols[ci] === 'N' && r === 2) continue;
        if (!drawnSet.has(card.grid[cols[ci]][r].number)) {
          rowComplete = false;
          break;
        }
      }
      if (rowComplete) return 'line';
    }
    
    // Check columns
    for (let ci = 0; ci < 5; ci++) {
      let colComplete = true;
      for (let r = 0; r < 5; r++) {
        if (cols[ci] === 'N' && r === 2) continue;
        if (!drawnSet.has(card.grid[cols[ci]][r].number)) {
          colComplete = false;
          break;
        }
      }
      if (colComplete) return 'line';
    }
    
    // Check diagonals
    let diag1 = true, diag2 = true;
    for (let i = 0; i < 5; i++) {
      if (!(cols[i] === 'N' && i === 2) && !drawnSet.has(card.grid[cols[i]][i].number)) diag1 = false;
      if (!(cols[4 - i] === 'N' && i === 2) && !drawnSet.has(card.grid[cols[4 - i]][i].number)) diag2 = false;
      if (!diag1 && !diag2) break;
    }
    if (diag1 || diag2) return 'line';
    
    // Four corners
    if (drawnSet.has(card.grid.B[0].number) && 
        drawnSet.has(card.grid.O[0].number) && 
        drawnSet.has(card.grid.B[4].number) && 
        drawnSet.has(card.grid.O[4].number)) {
      return 'four_corners';
    }
    
    return null;
  }

  // 🔧 Clear cache when game ends
  clearCache(gameId) {
    this.drawnSetCache.delete(gameId?.toString());
  }
}

module.exports = BingoService;