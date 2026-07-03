const Game = require('../../models/Game');
const GameConfig = require('../../models/GameConfig');
const Card = require('../../models/Card');
const User = require('../../models/User');
const Transaction = require('../../models/Transaction');
const timerManager = require('../../utils/TimerManager');

class GameFlowService {
  constructor(engine) {
    this.engine = engine;
    this.activeCardCounts = new Map(); // Cache active card counts per game
  }

  // 🔧 OPTIMIZED: Reset ALL 400 cards using bulkWrite (1 operation instead of 400)
  async resetAllCards(roomId) {
    console.log('🔄 [RESET] Resetting all cards to initial state...');
    
    const startTime = Date.now();
    
    // Fetch all 400 cards with only grid field needed
    const allCards = await Card.find(
      { displayId: { $gte: 10001, $lte: 10400 } },
      { grid: 1 }
    ).lean();
    
    if (allCards.length === 0) {
      console.log('⚠️ [RESET] No cards found to reset');
      return;
    }
    
    // Build bulk operations for ALL cards in one go
    const bulkOps = allCards.map(card => {
      const setFields = {
        status: 'available',
        userId: null,
        gameId: null,
        isBlocked: false,
        bingoCalled: false,
        bingoValidated: false,
        winType: null,
        reservedBy: null,
        reservedAt: null,
        registeredAt: null
      };
      
      // Reset grid marks (only FREE space stays marked)
      ['B', 'I', 'N', 'G', 'O'].forEach(col => {
        if (card.grid && card.grid[col]) {
          setFields[`grid.${col}`] = card.grid[col].map(cell => ({
            ...cell,
            isMarked: cell.number === 0 // Only FREE space (number 0) is marked
          }));
        }
      });
      
      return {
        updateOne: {
          filter: { _id: card._id },
          update: { $set: setFields }
        }
      };
    });
    
    // Execute ALL updates in a single bulkWrite
    if (bulkOps.length > 0) {
      const result = await Card.bulkWrite(bulkOps, { ordered: false });
      console.log(`✅ [RESET] ${result.modifiedCount} cards reset in ${Date.now() - startTime}ms (single operation)`);
    }
    
    // Clear cached counts
    this.activeCardCounts.clear();
  }

  startCountdown(roomId, game, config) {
    timerManager.clearTimeout(`countdown_${roomId}`);
    timerManager.clearInterval(`poll_${roomId}`);

    const delayMs = config.waitTimeSeconds * 1000;
    const adjustedDelay = Math.max(0, delayMs - 1500); // Start 1.5s early to compensate processing
    
    timerManager.createTimeout(`countdown_${roomId}`, async () => {
      const current = await Game.findById(game._id).lean();
      if (!current || current.status === 'completed') return;

      const playerCount = current.players ? current.players.length : 0;

      if (playerCount >= config.minPlayersToStart) {
        timerManager.clearInterval(`poll_${roomId}`);
        
        // Update status first
        await Game.updateOne(
          { _id: current._id },
          { $set: { status: 'in_progress', startTime: new Date() } }
        );
        
        // Emit immediately (before other processing)
        this.engine.io.to(roomId).emit('gameStarted', {
          gameId: current.gameId,
          gameNumber: current.gameNumber,
          prizePool: current.prizePool,
          playerCount: current.players?.length || 0,
          totalCards: current.totalCards
        });

        // Fetch full game object for drawNumbers
        const fullGame = await Game.findById(current._id);
        this.drawNumbers(roomId, fullGame, config);
        
      } else if (playerCount === 0 && config.resetOnNoPlayers) {
        await Game.updateOne(
          { _id: current._id },
          { $set: { timerStartedAt: new Date(), status: 'waiting' } }
        );
        
        this.engine.io.to(roomId).emit('countdownReset', {
          timerStartedAt: new Date(),
          timerDuration: config.waitTimeSeconds
        });
        
        const updatedGame = await Game.findById(current._id);
        this.startCountdown(roomId, updatedGame, config);
      } else {
        const updatedGame = await Game.findById(current._id);
        this.startPlayerPoll(roomId, updatedGame, config);
      }
    }, adjustedDelay, 'game_countdown');
  }

  startPlayerPoll(roomId, game, config) {
    const pc = this.engine.getPlayerCount(game);
    this.engine.io.to(roomId).emit('waitingForPlayers', { 
      needPlayers: config.minPlayersToStart - pc 
    });
    
    timerManager.createInterval(`poll_${roomId}`, async () => {
      const updated = await Game.findById(game._id).lean();
      if (!updated || updated.status === 'completed') { 
        timerManager.clearInterval(`poll_${roomId}`); 
        return; 
      }
      
      const currentPlayers = updated.players ? updated.players.length : 0;
      
      if (currentPlayers >= config.minPlayersToStart) {
        timerManager.clearInterval(`poll_${roomId}`);
        const fullGame = await Game.findById(updated._id);
        await this.startGame(roomId, fullGame, config);
      } else if (currentPlayers === 0 && config.resetOnNoPlayers) {
        timerManager.clearInterval(`poll_${roomId}`);
        await Game.updateOne(
          { _id: updated._id },
          { $set: { timerStartedAt: new Date() } }
        );
        this.engine.io.to(roomId).emit('countdownReset', { 
          timerStartedAt: new Date() 
        });
        const fullGame = await Game.findById(updated._id);
        this.startCountdown(roomId, fullGame, config);
      }
    }, 3000, 'player_poll');
  }

  async startGame(roomId, game, config) {
    timerManager.clearInterval(`poll_${roomId}`);
    
    // Emit BEFORE save for instant response
    this.engine.io.to(roomId).emit('gameStarted', {
      gameId: game.gameId,
      gameNumber: game.gameNumber,
      prizePool: game.prizePool,
      playerCount: this.engine.getPlayerCount(game),
      totalCards: game.totalCards
    });
    
    // Save in background
    game.status = 'in_progress';
    game.startTime = new Date();
    await game.save();

    this.drawNumbers(roomId, game, config);
  }

  drawNumbers(roomId, game, config) {
    let idx = 0;
    const gameId = game._id;
    const gameIdStr = gameId.toString();
    let cachedGame = game;
    let activeCountCache = null;
    let lastCountCheck = 0;
    
    timerManager.clearInterval(`draw_${roomId}`);
    
    // Initialize active card count
    Card.countDocuments({ 
      gameId, status: 'registered', isBlocked: false, bingoCalled: false 
    }).then(count => {
      activeCountCache = count;
      this.activeCardCounts.set(gameIdStr, count);
    });
    
    timerManager.createInterval(`draw_${roomId}`, async () => {
      // 🔧 Only fetch full game every 5 draws or when needed
      if (idx % 5 === 0 || !cachedGame || idx >= cachedGame.allNumbers.length) {
        cachedGame = await Game.findById(gameId).lean();
        if (!cachedGame) {
          timerManager.clearInterval(`draw_${roomId}`);
          return;
        }
      }
      
      if (!cachedGame || cachedGame.status === 'completed' || cachedGame.status === 'grace_period') {
        timerManager.clearInterval(`draw_${roomId}`); 
        return;
      }
      
      if (idx >= cachedGame.allNumbers.length) {
        timerManager.clearInterval(`draw_${roomId}`);
        const fullGame = await Game.findById(gameId);
        await this.endGame(roomId, fullGame);
        return;
      }
      
      // 🔧 Only check active cards every 10 draws (or if count is low)
      if (idx % 10 === 0 || idx === 0 || (activeCountCache !== null && activeCountCache < 5)) {
        const freshCount = await Card.countDocuments({ 
          gameId, status: 'registered', isBlocked: false, bingoCalled: false 
        });
        activeCountCache = freshCount;
        this.activeCardCounts.set(gameIdStr, freshCount);
        lastCountCheck = idx;
      }
      
      if (activeCountCache === 0 && cachedGame.totalCards > 0) {
        timerManager.clearInterval(`draw_${roomId}`);
        
        // Refund all players
        const cards = await Card.find({ gameId, status: 'registered' });
        const refundOps = [];
        const transactionOps = [];
        
        for (const card of cards) {
          refundOps.push({
            updateOne: {
              filter: { _id: card.userId },
              update: { $inc: { walletBalance: card.price } }
            }
          });
          
          transactionOps.push({
            userId: card.userId,
            type: 'refund',
            amount: card.price,
            gameId: cachedGame.gameId,
            gameNumber: cachedGame.gameNumber,
            description: 'Refund - all cards blocked',
            balanceAfter: 0 // Will be updated
          });
        }
        
        if (refundOps.length > 0) {
          await User.bulkWrite(refundOps, { ordered: false });
        }
        
        // Update users and create transactions
        for (const card of cards) {
          const user = await User.findById(card.userId);
          if (user) {
            await Transaction.create({
              userId: user._id,
              type: 'refund',
              amount: card.price,
              gameId: cachedGame.gameId,
              gameNumber: cachedGame.gameNumber,
              description: 'Refund - all cards blocked',
              balanceAfter: user.walletBalance
            });
          }
        }
        
        await Game.updateOne(
          { _id: gameId },
          { $set: { status: 'completed', endTime: new Date(), endReason: 'all_cards_blocked' } }
        );
        
        await this.resetAllCards(roomId);
        
        this.engine.io.to(roomId).emit('gameEnded', { 
          gameId: cachedGame._id, 
          winners: [], 
          prizePool: cachedGame.prizePool, 
          reason: 'All cards blocked', 
          refunded: true 
        });
        
        this.scheduleNewGame(roomId);
        return;
      }
      
      // Draw number
      const num = cachedGame.allNumbers[idx];
      const letter = this.engine.getBingoLetter(num);
      
      // 🔧 Batch save: only persist to DB every 5 draws
      const newNumber = { number: num, letter };
      
      if (idx % 5 === 0) {
        await Game.updateOne(
          { _id: gameId },
          { 
            $set: { currentNumber: newNumber },
            $push: { drawnNumbers: newNumber }
          }
        );
      } else {
        // Just push without waiting (fire and forget)
        Game.updateOne(
          { _id: gameId },
          { 
            $set: { currentNumber: newNumber },
            $push: { drawnNumbers: newNumber }
          }
        ).catch(err => console.error('Batch save error:', err));
      }
      
      // Update local cache
      if (!cachedGame.drawnNumbers) cachedGame.drawnNumbers = [];
      cachedGame.drawnNumbers.push(newNumber);
      cachedGame.currentNumber = newNumber;
      
      // Emit immediately (no DB wait)
      this.engine.io.to(roomId).emit('numberDrawn', { 
        number: num, 
        letter, 
        drawCount: idx + 1, 
        totalNumbers: cachedGame.allNumbers.length 
      });
      
      // 🔧 OPTIMIZED: Auto-bingo using batch check
if (config?.autoBingoEnabled && idx >= 4) {
    const allRegisteredCards = await Card.find({ 
      gameId, 
      status: 'registered', 
      isBlocked: false, 
      bingoCalled: false 
    }).lean();
    
    if (allRegisteredCards.length > 0) {
      // 🔧 Use batch check - builds drawnSet ONCE for all cards
      const results = this.engine.bingo.checkMultipleCards(
        allRegisteredCards, 
        cachedGame.drawnNumbers, 
        config
      );
      
      // Process results
      for (const { cardId, winType } of results) {
        if (winType) {
          const card = allRegisteredCards.find(c => c._id.toString() === cardId.toString());
          if (!card) continue;
          
          // Update card
          await Card.updateOne(
            { _id: card._id },
            { 
              $set: { 
                bingoCalled: true, 
                bingoCallTime: new Date(), 
                winType 
              } 
            }
          );
          
          const fullGame = await Game.findById(gameId);
          
          if (fullGame.status === 'in_progress') {
            timerManager.clearInterval(`draw_${roomId}`);
            
            await Game.updateOne(
              { _id: gameId },
              { 
                $set: { 
                  status: 'bingo_called',
                  gracePeriodEndTime: new Date(Date.now() + (config.gracePeriodSeconds || 10) * 1000)
                } 
              }
            );
            
            this.engine.io.to(roomId).emit('firstBingo', { 
              userId: card.userId, 
              cardId: card._id, 
              cardNumber: card.cardNumber, 
              winType, 
              autoBingo: true 
            });
            
            timerManager.createTimeout(`grace_${roomId}`, 
              () => this.endGracePeriod(roomId, gameId), 
              (config.gracePeriodSeconds || 10) * 1000, 
              'grace_period'
            );
            return;
          } else {
            this.engine.io.to(roomId).emit('additionalBingo', { 
              userId: card.userId, 
              cardId: card._id, 
              cardNumber: card.cardNumber, 
              winType, 
              autoBingo: true 
            });
          }
        }
      }
    }
}
      
      idx++;
    }, config.drawIntervalSeconds * 1000, 'number_draw');
  }

  async endGracePeriod(roomId, gameId) {
    const game = await Game.findById(gameId).lean();
    if (!game || game.status === 'completed') return;
    
    const config = await GameConfig.findOne({ roomId: game.roomId }).lean();
    
    // 🔧 Parallel fetch called cards
    const calledCards = await Card.find({ 
      gameId: game._id, 
      bingoCalled: true, 
      isBlocked: false 
    }).populate('userId').lean();
    
    // 🔧 Parallel win checks
    const winCheckPromises = calledCards.map(card => 
      this.engine.bingo.checkWin(card, game.drawnNumbers, config)
    );
    const winResults = await Promise.all(winCheckPromises);
    
    const winners = [];
    const cardUpdates = [];
    
    for (let i = 0; i < calledCards.length; i++) {
      if (winResults[i]) {
        cardUpdates.push({
          updateOne: {
            filter: { _id: calledCards[i]._id },
            update: { $set: { bingoValidated: true } }
          }
        });
        winners.push({ card: calledCards[i], winType: winResults[i] });
      }
    }
    
    // Bulk update validated cards
    if (cardUpdates.length > 0) {
      await Card.bulkWrite(cardUpdates, { ordered: false });
    }
    
    // Process winners
    if (winners.length > 0) {
      const commissionRate = config?.commissionPercentage || 10;
      const comm = (game.prizePool * commissionRate) / 100;
      const ppw = (game.prizePool - comm) / winners.length;
      
      const userUpdates = [];
      const transactionOps = [];
      const winnerEntries = [];
      
      for (const { card, winType } of winners) {
        userUpdates.push({
          updateOne: {
            filter: { _id: card.userId._id || card.userId },
            update: { $inc: { walletBalance: ppw } }
          }
        });
        
        // Fetch user after update for balance
        const user = await User.findById(card.userId._id || card.userId);
        
        transactionOps.push({
          userId: user._id,
          type: 'prize_win',
          amount: ppw,
          gameId: game.gameId,
          gameNumber: game.gameNumber,
          description: `Won with ${winType}`,
          balanceAfter: (user.walletBalance || 0) + ppw
        });
        
        winnerEntries.push({
          userId: user._id,
          cardId: card._id,
          winType,
          prizeAmount: ppw,
          winnerName: user.fullName,
          winnerPhone: user.phone,
          cardNumber: card.cardNumber,
          cardGrid: card.grid,
          newBalance: (user.walletBalance || 0) + ppw
        });
      }
      
      // Bulk update user balances
      await User.bulkWrite(userUpdates, { ordered: false });
      
      // Create transactions
      if (transactionOps.length > 0) {
        await Transaction.insertMany(transactionOps);
      }
      
      // Commission transaction
      await Transaction.create({ 
        type: 'commission', 
        amount: comm, 
        gameId: game.gameId, 
        gameNumber: game.gameNumber, 
        description: 'Commission' 
      });
      
      // Update game with winners
      await Game.updateOne(
        { _id: gameId },
        { 
          $set: { 
            winners: winnerEntries, 
            commission: comm,
            status: 'completed',
            endTime: new Date()
          } 
        }
      );
    } else {
      await Game.updateOne(
        { _id: gameId },
        { $set: { status: 'completed', endTime: new Date() } }
      );
    }
    
    // Reset cards
    await this.resetAllCards(roomId);
    
    timerManager.clearInterval(`draw_${roomId}`);
    timerManager.clearTimeout(`grace_${roomId}`);
    
    // Fetch final game state for emit
    const finalGame = await Game.findById(gameId).lean();
    
    this.engine.io.to(roomId).emit('gameEnded', { 
      gameId: game._id, 
      winners: finalGame.winners || [], 
      prizePool: game.prizePool, 
      commission: finalGame.commission || 0, 
      balance: finalGame.winners?.[0]?.newBalance || 0 
    });
    
    this.scheduleNewGame(roomId);
  }

  async endGame(roomId, game) {
    // Bulk update game status
    await Game.updateOne(
      { _id: game._id },
      { 
        $set: { 
          status: 'completed', 
          endTime: new Date(), 
          endReason: game.endReason || 'all_numbers_drawn' 
        } 
      }
    );
    
    await this.resetAllCards(roomId);
    
    timerManager.clearInterval(`draw_${roomId}`);
    
    // Process refunds in bulk
    const cards = await Card.find({ gameId: game._id, status: 'registered' }).lean();
    let totalRefunded = 0;
    
    if (cards.length > 0) {
      const userUpdates = [];
      const transactions = [];
      
      for (const card of cards) {
        userUpdates.push({
          updateOne: {
            filter: { _id: card.userId },
            update: { $inc: { walletBalance: card.price } }
          }
        });
        
        totalRefunded += card.price;
        
        const user = await User.findById(card.userId).lean();
        if (user) {
          transactions.push({
            userId: user._id,
            type: 'refund',
            amount: card.price,
            gameId: game.gameId,
            gameNumber: game.gameNumber,
            description: 'Refund - no winner',
            balanceAfter: user.walletBalance + card.price
          });
        }
      }
      
      // Bulk update user balances
      if (userUpdates.length > 0) {
        await User.bulkWrite(userUpdates, { ordered: false });
      }
      
      // Bulk create transactions
      if (transactions.length > 0) {
        await Transaction.insertMany(transactions);
      }
    }
    
    this.engine.io.to(roomId).emit('gameEnded', { 
      gameId: game._id, 
      winners: [], 
      prizePool: game.prizePool, 
      reason: 'No winner', 
      refunded: true, 
      totalRefunded, 
      balance: totalRefunded > 0 ? undefined : 0 
    });
    
    this.scheduleNewGame(game.roomId);
  }

  async scheduleNewGame(roomId) {
    setTimeout(async () => {
      const conf = await GameConfig.findOne({ roomId }).lean();
      if (conf) {
        const ln = await Game.getLatestGameNumber(roomId);
        const ng = await Game.create({ 
          gameId: String(ln + 1).padStart(10, '0'), 
          gameNumber: ln + 1, 
          roomId, 
          status: 'scheduled', 
          allNumbers: this.engine.shuffleNumbers(), 
          timerDuration: conf.waitTimeSeconds 
        });
        this.engine.games.set(roomId, ng);
        this.engine.io.to(roomId).emit('newGameCreated', { 
          gameId: ng.gameId, 
          gameNumber: ng.gameNumber 
        });
      }
    }, 1000);
  }
}

module.exports = GameFlowService;