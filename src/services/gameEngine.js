const Game = require('../models/Game');
const GameConfig = require('../models/GameConfig');
const Card = require('../models/Card');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Notification = require('../models/Notification');
const timerManager = require('../utils/TimerManager');

// 🔍 DEBUG HELPERS
const DEBUG = true; // Set to false to disable all debug logs
const log = (...args) => DEBUG && console.log(...args);
const logError = (...args) => console.error(...args);
const divider = () => DEBUG && console.log('═'.repeat(60));

class GameEngine {
    constructor(io) {
        this.io = io;
        this.userSockets = new Map();
        this.games = new Map();
        this.activeGames = new Set();
        log('🎮 GameEngine initialized');
    }

    setUserSocket(userId, socketId) { 
        this.userSockets.set(userId.toString(), socketId); 
        log(`🔌 User socket set: ${userId} → ${socketId}`);
    }
    
    removeUserSocket(userId) { 
        this.userSockets.delete(userId.toString()); 
        log(`🔌 User socket removed: ${userId}`);
    }
    
    getUserSocket(userId) {
        const socketId = this.userSockets.get(userId.toString());
        if (socketId) return this.io.sockets.sockets.get(socketId);
        return null;
    }
    
    cleanup() { 
        log('🧹 GameEngine cleanup');
        timerManager.reportStats(); 
    }

    getPlayerCount(game) {
        if (!game) return 0;
        if (!game.players) return 0;
        if (!Array.isArray(game.players)) return 0;
        return game.players.length;
    }

    // ============================================
    // NOTIFICATIONS
    // ============================================
    async sendNotification(userId, data) {
        try {
            log(`📧 Sending notification to ${userId}: ${data.title}`);
            const notification = await Notification.create({
                user: userId, type: data.type || 'system',
                title: data.title, titleAm: data.titleAm, titleTg: data.titleTg,
                message: data.message, messageAm: data.messageAm, messageTg: data.messageTg,
                priority: data.priority || 'normal', amount: data.amount,
                expiresAt: data.expiresAt || new Date(Date.now() + 7*24*60*60*1000)
            });
            const socket = this.getUserSocket(userId);
            if (socket) {
                socket.emit('newNotification', notification);
                log(`📧 Notification sent to socket`);
            } else {
                log(`📧 User ${userId} not connected, notification saved to DB`);
            }
            return notification;
        } catch (e) { 
            logError(`❌ Failed to send notification: ${e.message}`);
            return null; 
        }
    }
    
    async sendRefundNotification(uid, amt, gn, reason) {
        log(`💸 Sending refund notification to ${uid}: ${amt} ETB for Game #${gn}`);
        return this.sendNotification(uid, { 
            type:'refund', title:'Refund Processed', 
            titleAm:'ተመላሽ ገንዘብ ተከፍሏል', titleTg:'ገንዘብ ተመላሽ ተደርጓል', 
            message:`Your ${amt} ETB refunded for Game #${gn}. ${reason}`, 
            messageAm:`${amt} ብር ለጨዋታ #${gn} ተመላሽ ተደርጓል።`, 
            messageTg:`ናይ ${amt} ብር ንጸወታ #${gn} ተመሊሱ።`, 
            priority:'high', amount:amt 
        });
    }
    
    async sendGameCancelledNotification(uid, gn) {
        log(`🚫 Sending game cancelled notification to ${uid}: Game #${gn}`);
        return this.sendNotification(uid, { 
            type:'game_cancelled', title:'Game Cancelled', 
            titleAm:'ጨዋታ ተሰርዟል', titleTg:'ጸወታ ተሰሪዙ', 
            message:`Game #${gn} interrupted. Cards refunded.`, 
            messageAm:`ጨዋታ #${gn} ተቋርጧል።`, 
            messageTg:`ጸወታ #${gn} ተቋሪጹ።`, 
            priority:'high' 
        });
    }
    
    async sendWinningNotification(uid, amt, gn, wt) {
        log(`🏆 Sending winning notification to ${uid}: ${amt} ETB for Game #${gn} (${wt})`);
        return this.sendNotification(uid, { 
            type:'winning', title:'You Won!', 
            titleAm:'አሸንፈዋል!', titleTg:'ተዓዊትኩም!', 
            message:`You won ${amt} ETB in Game #${gn} (${wt})!`, 
            messageAm:`${amt} ብር አሸንፈዋል (${wt})!`, 
            messageTg:`${amt} ብር ተዓዊትኩም (${wt})!`, 
            priority:'high', amount:amt 
        });
    }

    // ============================================
    // REFUND LOGIC
    // ============================================
    async refundGame(gameId, reason = 'server_interruption') {
        divider();
        log(`💸 REFUND GAME STARTED: ${gameId} - Reason: ${reason}`);
        
        const game = await Game.findById(gameId);
        if (!game) {
            logError(`❌ Game not found: ${gameId}`);
            throw new Error('Game not found');
        }
        
        log(`📊 Game #${game.gameNumber} - Status: ${game.status}, Prize Pool: ${game.prizePool}`);
        
        const cards = await Card.find({ gameId: game._id, status: 'registered' });
        log(`📊 Found ${cards.length} registered cards to refund`);
        
        const stats = { 
            totalCards: cards.length, 
            totalAmount: 0, 
            successfulRefunds: 0, 
            failedRefunds: 0, 
            refundedUsers: new Set() 
        };
        
        for (const card of cards) {
            try { 
                await this.refundSingleCard(card, game, reason, stats); 
            } catch (e) { 
                logError(`❌ Failed to refund card ${card._id}: ${e.message}`);
                stats.failedRefunds++; 
            }
        }
        
        game.status = 'completed'; 
        game.endTime = new Date(); 
        game.endReason = reason;
        game.refundStats = { 
            totalRefunded: stats.totalAmount, 
            cardsRefunded: stats.successfulRefunds, 
            usersRefunded: stats.refundedUsers.size 
        };
        await game.save();
        
        log(`💸 REFUND COMPLETE:`);
        log(`   Total amount: ${stats.totalAmount} ETB`);
        log(`   Successful: ${stats.successfulRefunds}`);
        log(`   Failed: ${stats.failedRefunds}`);
        log(`   Users refunded: ${stats.refundedUsers.size}`);
        divider();
        
        return stats;
    }
    
    async refundSingleCard(card, game, reason, stats) {
        const user = await User.findById(card.userId);
        if (!user) {
            log(`⚠️ User not found for card ${card._id}`);
            return;
        }
        
        const amt = card.price || 0;
        const oldBalance = user.walletBalance;
        user.walletBalance += amt; 
        await user.save();
        
        log(`💰 Refunded ${amt} ETB to ${user.fullName || user._id} (${oldBalance} → ${user.walletBalance})`);
        
        await Transaction.create({ 
            userId: user._id, type: 'refund', amount: amt, 
            gameId: game.gameId, gameNumber: game.gameNumber, 
            description: `Refund Game #${game.gameNumber}`, 
            balanceAfter: user.walletBalance, cardId: card._id 
        });
        
        card.status = 'refunded'; 
        card.refundedAt = new Date(); 
        card.refundReason = reason; 
        await card.save();
        
        await this.sendRefundNotification(user._id, amt, game.gameNumber, reason);
        
        stats.totalAmount += amt; 
        stats.successfulRefunds++; 
        stats.refundedUsers.add(user._id.toString());
    }

    // ============================================
    // CRASH RECOVERY
    // ============================================
    async recoverFromCrash() {
        divider();
        log('🔄 CRASH RECOVERY STARTED');
        
        const stuckGames = await Game.find({ 
            status: { $in: ['in_progress','bingo_called','waiting','scheduled'] }, 
            updatedAt: { $lt: new Date(Date.now()-30000) } 
        });
        
        log(`📊 Found ${stuckGames.length} stuck games`);
        
        for (const game of stuckGames) {
            await this.decideAndRecover(game);
        }
        
        log('✅ Crash recovery complete');
        divider();
    }
    
    async decideAndRecover(game) {
        const pc = this.getPlayerCount(game);
        log(`\n🔍 Analyzing Game #${game.gameNumber} - Status: ${game.status}, Players: ${pc}, Last updated: ${game.updatedAt}`);
        
        if (await this.shouldRefundGame(game)) { 
            log(`→ Decision: REFUND`);
            await this.refundAndRestart(game); 
        } else { 
            log(`→ Decision: RECOVER`);
            await this.recoverAndResume(game); 
        }
    }
    
    async shouldRefundGame(game) {
        const config = await GameConfig.findOne({ roomId: game.roomId });
        
        if (game.status === 'waiting' || game.status === 'scheduled') {
            if (config && game.timerStartedAt) {
                const elapsed = (Date.now() - game.timerStartedAt.getTime()) / 1000;
                const maxWait = Math.max(config.waitTimeSeconds * 3, 120);
                log(`   Elapsed: ${elapsed}s, Max wait: ${maxWait}s`);
                if (elapsed > maxWait) return true;
            }
            return false;
        }
        
        const inactiveTime = (Date.now() - game.updatedAt) / 1000;
        log(`   Inactive for: ${inactiveTime}s`);
        
        if (inactiveTime > 600) return true;
        if (game.drawnNumbers && game.drawnNumbers.length < 5) return true;
        
        return false;
    }
    
    async refundAndRestart(game) {
        log(`🔄 Refunding and restarting Game #${game.gameNumber}`);
        const stats = await this.refundGame(game._id, 'server_interruption');
        this.io.to(game.roomId).emit('gameCancelled', { gameNumber: game.gameNumber });
        await this.createNewGameAfterDelay(game.roomId, 3000);
    }
    
    async recoverAndResume(game) {
        const config = await GameConfig.findOne({ roomId: game.roomId });
        if (!config) { 
            log(`⚠️ No config found, refunding`);
            await this.refundAndRestart(game); 
            return; 
        }
        
        this.games.set(game.roomId, game);
        
        switch(game.status) {
            case 'scheduled': 
            case 'waiting': 
                await this.recoverWaitingGame(game, config); 
                break;
            case 'in_progress': 
                await this.recoverRunningGame(game, config); 
                break;
            case 'bingo_called': 
                await this.recoverGracePeriod(game, config); 
                break;
        }
    }
    
    async recoverWaitingGame(game, config) {
        const pc = this.getPlayerCount(game);
        const elapsed = game.timerStartedAt ? (Date.now() - game.timerStartedAt.getTime()) / 1000 : 0;
        const tr = Math.max(0, config.waitTimeSeconds - elapsed);
        
        log(`⏱️ Recovering waiting game - Elapsed: ${elapsed}s, Remaining: ${tr}s, Players: ${pc}/${config.minPlayersToStart}`);
        
        if (tr <= 0 && pc >= config.minPlayersToStart) { 
            await this.startGame(game.roomId, game, config); 
        } else if (tr <= 0) { 
            this.startPlayerPoll(game.roomId, game, config); 
        } else { 
            this.startCountdown(game.roomId, game, config); 
        }
    }
    
    async recoverRunningGame(game, config) {
        log(`🏃 Recovering running game - Drawn: ${game.drawnNumbers?.length || 0} numbers`);
        let idx = game.drawnNumbers.length;
        
        timerManager.createInterval(`draw_${game.roomId}`, async () => {
            const current = await Game.findById(game._id);
            if (!current || current.status === 'completed' || current.status === 'grace_period') { 
                timerManager.clearInterval(`draw_${game.roomId}`); 
                return; 
            }
            if (idx >= current.allNumbers.length) { 
                timerManager.clearInterval(`draw_${game.roomId}`); 
                await this.endGame(game.roomId, current); 
                return; 
            }
            const num = current.allNumbers[idx], letter = this.getBingoLetter(num);
            current.currentNumber = { number: num, letter }; 
            current.drawnNumbers.push({ number: num, letter }); 
            await current.save();
            this.io.to(game.roomId).emit('numberDrawn', { number: num, letter, drawCount: idx + 1 });
            idx++;
        }, config.drawIntervalSeconds * 1000, 'number_draw');
    }
    
    async recoverGracePeriod(game, config) {
        const ge = game.gracePeriodEndTime ? (Date.now() - game.gracePeriodEndTime.getTime()) / 1000 : 999;
        log(`⏰ Recovering grace period - Time since end: ${ge}s`);
        
        if (ge >= 0) { 
            await this.endGracePeriod(game.roomId, game._id); 
        } else { 
            timerManager.createTimeout(`grace_${game.roomId}`, 
                () => this.endGracePeriod(game.roomId, game._id), 
                Math.abs(ge) * 1000, 'grace_period'); 
        }
    }
    
    async createNewGameAfterDelay(roomId, delay) {
        log(`🆕 Creating new game in ${delay}ms for room ${roomId}`);
        return new Promise(resolve => setTimeout(async () => {
            const config = await GameConfig.findOne({ roomId, isActive: true });
            if (!config) { 
                log(`⚠️ No active config for room ${roomId}`);
                resolve(false); 
                return; 
            }
            const lastNum = await Game.getLatestGameNumber(roomId);
            const newGame = await Game.create({ 
                gameId: String(lastNum + 1).padStart(10, '0'), 
                gameNumber: lastNum + 1, roomId, 
                status: 'scheduled', 
                allNumbers: this.shuffleNumbers(), 
                timerDuration: config.waitTimeSeconds 
            });
            this.games.set(roomId, newGame);
            this.io.to(roomId).emit('newGameCreated', { 
                gameId: newGame.gameId, 
                gameNumber: newGame.gameNumber 
            });
            log(`✅ New game created: #${newGame.gameNumber}`);
            resolve(true);
        }, delay));
    }

    async initializeRoom(roomId) {
        log(`🏠 Initializing room: ${roomId}`);
        const config = await GameConfig.findOne({ roomId, isActive: true });
        if (!config) {
            log(`⚠️ No active config for room ${roomId}`);
            return null;
        }
        
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
            log(`🆕 Created new game #${game.gameNumber} for room ${roomId}`);
        } else {
            log(`✅ Found existing game #${game.gameNumber} for room ${roomId}`);
        }
        
        this.games.set(roomId, game);
        return game;
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

    // ============================================
    // CARD OPERATIONS
    // ============================================
    async buyCard(roomId, userId) {
        log(`\n🛒 [BUY CARD] User: ${userId}, Room: ${roomId}`);
        
        const game = await Game.getActiveGame(roomId);
        if (!game || (game.status !== 'scheduled' && game.status !== 'waiting')) {
            logError(`❌ Game not available. Status: ${game?.status}`);
            throw new Error('Game not available');
        }
        
        const config = await GameConfig.findOne({ roomId });
        if (!config) throw new Error('Config not found');
        
        const player = game.players.find(p => p.userId.toString() === userId);
        const cc = player?.cards?.length || 0;
        
        if (cc >= config.maxCardsPerPlayer) {
            logError(`❌ Max cards reached: ${cc}/${config.maxCardsPerPlayer}`);
            throw new Error(`Max ${config.maxCardsPerPlayer} cards`);
        }
        
        const user = await User.findById(userId);
        if (user.walletBalance < config.cardPrice) {
            logError(`❌ Insufficient balance: ${user.walletBalance} < ${config.cardPrice}`);
            throw new Error(`Need ${config.cardPrice} coins`);
        }
        
        user.walletBalance -= config.cardPrice; 
        await user.save();
        
        const card = await Card.create({ 
            gameId: game._id, userId, 
            cardNumber: game.totalCards + 1, 
            grid: this.generateGrid(), 
            price: config.cardPrice, 
            status: 'registered' 
        });
        
        if (!player) game.players.push({ userId, cards: [card._id] });
        else player.cards.push(card._id);
        
        game.totalCards += 1; 
        game.prizePool += config.cardPrice;
        
        await Transaction.create({ 
            userId, type: 'card_purchase', amount: -config.cardPrice, 
            gameId: game.gameId, gameNumber: game.gameNumber, 
            description: `Card #${card.cardNumber}`, 
            balanceAfter: user.walletBalance 
        });
        
        if (game.players.length === 1 && !game.timerStartedAt) {
            game.timerStartedAt = new Date(); 
            game.status = 'waiting'; 
            this.startCountdown(roomId, game, config);
        }
        
        await game.save();
        
        log(`✅ Card purchased: #${card.cardNumber}, Total cards: ${game.totalCards}, Prize pool: ${game.prizePool}, Players: ${game.players.length}`);
        
        this.io.to(roomId).emit('cardPurchased', { 
            userId, totalCards: game.totalCards, 
            playerCount: game.players.length, 
            prizePool: game.prizePool, 
            timerStartedAt: game.timerStartedAt, 
            timerDuration: game.timerDuration 
        });
        
        return { success: true, card, newBalance: user.walletBalance, cardsOwned: cc + 1 };
    } 
     

    async previewCard(roomId, userId) {
        log(`\n👁️ [PREVIEW CARD] User: ${userId}, Room: ${roomId}`);
        
        const game = await Game.getActiveGame(roomId);
        if (!game || (game.status !== 'scheduled' && game.status !== 'waiting')) {
            logError(`❌ Game not available for preview`);
            throw new Error('Game not available');
        }
        
        const config = await GameConfig.findOne({ roomId });
        const rc = await Card.countDocuments({ gameId: game._id, userId, status: 'registered' });
        
        if (rc >= config.maxCardsPerPlayer) {
            logError(`❌ Max cards reached: ${rc}/${config.maxCardsPerPlayer}`);
            throw new Error(`Max ${config.maxCardsPerPlayer} cards`);
        }
        
        const card = await Card.create({ 
            gameId: game._id, userId, 
            cardNumber: game.totalCards + 1, 
            grid: this.generateGrid(), 
            price: config.cardPrice, 
            status: 'preview' 
        });
        
        log(`✅ Preview card created: ${card._id}, Price: ${card.price} ETB`);
        
        const sock = this.getUserSocket(userId);
        if (sock) sock.emit('previewCardGenerated', { userId, card });
        // 🔥 Send updated game state immediately

        
        return { success: true, card };
    }
    async previewCards(roomId, userId, quantity) {
  console.log('🔴 [BATCH PREVIEW] Called:', { roomId, userId, quantity });
  
  const game = await Game.getActiveGame(roomId);
  if (!game || (game.status !== 'scheduled' && game.status !== 'waiting')) {
    console.log('🔴 [BATCH PREVIEW] Game not available:', game?.status);
    throw new Error('Game not available');
  }
  
  const config = await GameConfig.findOne({ roomId });
  const registeredCount = await Card.countDocuments({ gameId: game._id, userId, status: 'registered' });
  const previewCount = await Card.countDocuments({ gameId: game._id, userId, status: 'preview' });
  
  console.log('🔴 [BATCH PREVIEW] Counts:', { registeredCount, previewCount, max: config.maxCardsPerPlayer });
  
  const available = config.maxCardsPerPlayer - registeredCount - previewCount;
  const actualQty = Math.min(quantity, available);
  console.log('🔴 [BATCH PREVIEW] Creating:', actualQty, 'cards');
  
  if (actualQty <= 0) throw new Error(`Max ${config.maxCardsPerPlayer} cards`);
  
 const cards = [];
for (let i = 0; i < actualQty; i++) {
  cards.push({
    gameId: game._id, 
    userId,
    cardId: new (require('mongoose').Types.ObjectId)(), // 🔥 Add unique cardId
    cardNumber: game.totalCards + i + 1,
    grid: this.generateGrid(),
    price: config.cardPrice,
    status: 'preview'
  });
}
  
  const created = await Card.insertMany(cards);
  console.log('🔴 [BATCH PREVIEW] Created:', created.length, 'cards');
  
  const sock = this.getUserSocket(userId);
  if (sock) {
    created.forEach(card => {
      sock.emit('previewCardGenerated', { userId, card });
    });
  }
  
  return { success: true, count: created.length };
}

    async registerCard(roomId, userId, cardId) {
        divider();
        log(`\n📝 [REGISTER CARD] Starting - User: ${userId}, Card: ${cardId}, Room: ${roomId}`);
        
        // 1. Validate game
        const game = await Game.getActiveGame(roomId);
        if (!game || (game.status !== 'scheduled' && game.status !== 'waiting')) {
            logError(`❌ Game not available. Status: ${game?.status}`);
            throw new Error('Game not available');
        }
        log(`✅ Game: #${game.gameNumber}, Status: ${game.status}`);
        
        // 2. Get config
        const config = await GameConfig.findOne({ roomId });
        if (!config) {
            logError(`❌ Config not found`);
            throw new Error('Config not found');
        }
        log(`⚙️ Config: Card Price=${config.cardPrice}, Max Cards=${config.maxCardsPerPlayer}, Commission=${config.commissionPercentage || 10}%`);
        
        // 3. Validate card
        const card = await Card.findOne({ _id: cardId, gameId: game._id, userId, status: 'preview' });
        if (!card) {
            logError(`❌ Card not found or not preview`);
            throw new Error('Card not found');
        }
        log(`🃏 Card: Price=${card.price} ETB`);
        
        const registeredCount = await Card.countDocuments({ 
  gameId: game._id, userId, status: 'registered' 
});
if (registeredCount >= config.maxCardsPerPlayer) {
  throw new Error(`Max ${config.maxCardsPerPlayer} cards already registered`);
}
        // 4. Check balance
        const user = await User.findById(userId);
        if (!user) {
            logError(`❌ User not found`);
            throw new Error('User not found');
        }
        if (user.walletBalance < card.price) {
            logError(`❌ Insufficient balance: ${user.walletBalance} < ${card.price}`);
            throw new Error(`Need ${card.price} ETB. You have ${user.walletBalance} ETB`);
        }
        log(`💰 Balance: ${user.walletBalance} ETB (sufficient)`);
        
        // 5. BEFORE state
        log(`\n📊 BEFORE UPDATE:`);
        log(`   totalCards: ${game.totalCards}`);
        log(`   prizePool: ${game.prizePool} ETB`);
        log(`   Expected pool after: ${game.prizePool + card.price} ETB`);
        log(`   players: ${game.players?.length || 0}`);
        
        // 6. Update game
        const ug = await Game.findOneAndUpdate(
            { _id: game._id, status: { $in: ['scheduled', 'waiting'] } },
            { 
                $inc: { totalCards: 1, prizePool: card.price },
                $set: { 
                    timerStartedAt: game.players.length === 0 ? new Date() : game.timerStartedAt,
                    status: game.players.length === 0 ? 'waiting' : game.status 
                }
            },
            { new: true }
        );
        
        if (!ug) {
            logError(`❌ Game update failed`);
            throw new Error('Game update failed');
        }
        
        // 7. AFTER state - VERIFY
        log(`\n📊 AFTER UPDATE:`);
        log(`   totalCards: ${ug.totalCards} (was ${game.totalCards}, +1)`);
        log(`   prizePool: ${ug.prizePool} ETB (was ${game.prizePool}, +${card.price})`);
        log(`   Expected: ${ug.totalCards} × ${card.price} = ${ug.totalCards * card.price} ETB`);
        log(`   Actual: ${ug.prizePool} ETB`);
        
        // 🔍 PRIZE POOL VERIFICATION
        if (ug.prizePool !== ug.totalCards * card.price) {
            logError(`\n⚠️⚠️⚠️ PRIZE POOL MISMATCH! ⚠️⚠️⚠️`);
            logError(`   Expected: ${ug.totalCards * card.price} ETB`);
            logError(`   Actual: ${ug.prizePool} ETB`);
            logError(`   Difference: ${ug.prizePool - (ug.totalCards * card.price)} ETB`);
            
            // Check all cards
            const allCards = await Card.find({ gameId: game._id, status: 'registered' });
            logError(`\n📋 All ${allCards.length} registered cards:`);
            let calcTotal = 0;
            allCards.forEach((c, i) => {
                logError(`   ${i+1}. Card #${c.cardNumber}: ${c.price} ETB (${c.status})`);
                calcTotal += c.price;
            });
            logError(`\n💰 Card sum: ${calcTotal} ETB, Game prizePool: ${ug.prizePool} ETB`);
        } else {
            log(`✅ Prize pool verified: ${ug.prizePool} ETB = ${ug.totalCards} × ${card.price}`);
        }
        
        // 8. Update card
        card.status = 'registered';
        card.cardNumber = ug.totalCards;
        card.registeredAt = new Date();
        await card.save();
        log(`🃏 Card #${card.cardNumber} registered`);
        
        // 9. Add to players
        const pi = ug.players.findIndex(p => p.userId.toString() === userId);
        if (pi === -1) {
            ug.players.push({ userId, cards: [card._id] });
            log(`👤 New player added. Total: ${ug.players.length}`);
        } else {
            ug.players[pi].cards.push(card._id);
            log(`👤 Existing player. Cards: ${ug.players[pi].cards.length}`);
        }
        await ug.save();
        
        // 10. Deduct balance
        const oldBalance = user.walletBalance;
        user.walletBalance -= card.price;
        await user.save();
        log(`💰 Balance: ${oldBalance} → ${user.walletBalance} (-${card.price})`);
        
        // 11. Transaction
        await Transaction.create({
            userId, type: 'card_purchase', amount: -card.price,
            gameId: ug.gameId, gameNumber: ug.gameNumber,
            description: `Card #${card.cardNumber}`,
            balanceAfter: user.walletBalance, cardId: card._id
        });
        log(`📄 Transaction created`);
        
        // 12. Start countdown
        if (ug.players.length === 1) {
            log(`⏱️ First player! Starting countdown...`);
            this.startCountdown(roomId, ug, config);
        }
        
        // 13. Emit events
        log(`\n📡 Emitting events:`);
        log(`   cardRegistered → room: totalCards=${ug.totalCards}, prizePool=${ug.prizePool}, players=${ug.players.length}`);
        log(`   balanceUpdated → user: newBalance=${user.walletBalance}`);
        
        this.io.to(roomId).emit('cardRegistered', {
            userId, cardId: card._id, cardNumber: card.cardNumber,
            totalCards: ug.totalCards, playerCount: ug.players.length,
            prizePool: ug.prizePool, timerStartedAt: ug.timerStartedAt,
            timerDuration: ug.timerDuration
        });
        
        const sock = this.getUserSocket(userId);
        if (sock) {
            sock.emit('balanceUpdated', { newBalance: user.walletBalance, cardNumber: card.cardNumber });
        }
        
        log(`✅ Registration complete! Card #${card.cardNumber}`);
        divider();
        
        return { success: true, cardNumber: card.cardNumber, newBalance: user.walletBalance };
    }

    async cancelPreviewCard(roomId, userId, cardId) {
        log(`🗑️ [CANCEL PREVIEW] User: ${userId}, Card: ${cardId}`);
        await Card.deleteOne({ _id: cardId, userId, status: 'preview' });
        const sock = this.getUserSocket(userId);
        if (sock) sock.emit('previewCardCancelled', { userId, cardId });
        return { success: true };
    }

    // ============================================
    // GAME START LOGIC
    // ============================================
    startCountdown(roomId, game, config) {
        log(`\n⏱️ [COUNTDOWN] Starting - ${config.waitTimeSeconds}s for Game #${game.gameNumber}`);
        timerManager.clearTimeout(`countdown_${roomId}`);
        timerManager.clearInterval(`poll_${roomId}`);
        
        timerManager.createTimeout(`countdown_${roomId}`, async () => {
            try {
                const current = await Game.findById(game._id);
                if (!current || current.status === 'completed') {
                    log(`[COUNTDOWN] Game already completed, skipping`);
                    return;
                }
                
                const playerCount = current.players ? current.players.length : 0;
                log(`\n⏰ [COUNTDOWN EXPIRED] Game #${current.gameNumber}`);
                log(`   Players: ${playerCount}/${config.minPlayersToStart}`);
                log(`   Total cards: ${current.totalCards}`);
                log(`   Prize pool: ${current.prizePool} ETB`);
                
                if (playerCount >= config.minPlayersToStart) {
                    log(`   ✅ STARTING GAME!`);
                    await this.startGame(roomId, current, config);
                } else if (playerCount === 0 && config.resetOnNoPlayers) {
                    log(`   🔄 No players, resetting timer`);
                    current.timerStartedAt = new Date();
                    current.status = 'waiting';
                    await current.save();
                    this.io.to(roomId).emit('countdownReset', { 
                        timerStartedAt: current.timerStartedAt, 
                        timerDuration: config.waitTimeSeconds 
                    });
                    this.startCountdown(roomId, current, config);
                } else {
                    log(`   ⏳ Not enough players, starting poll`);
                    this.startPlayerPoll(roomId, current, config);
                }
            } catch (e) {
                logError(`❌ [COUNTDOWN] Error:`, e);
            }
        }, config.waitTimeSeconds * 1000, 'game_countdown');
    }

    startPlayerPoll(roomId, game, config) {
        const pc = this.getPlayerCount(game);
        log(`\n🔍 [POLL] Starting - Players: ${pc}/${config.minPlayersToStart} for Game #${game.gameNumber}`);
        
        this.io.to(roomId).emit('waitingForPlayers', { needPlayers: config.minPlayersToStart - pc });
        
        timerManager.createInterval(`poll_${roomId}`, async () => {
            try {
                const updated = await Game.findById(game._id);
                if (!updated || updated.status === 'completed') {
                    timerManager.clearInterval(`poll_${roomId}`);
                    return;
                }
                
                const currentPlayers = updated.players ? updated.players.length : 0;
                
                if (currentPlayers >= config.minPlayersToStart) {
                    log(`\n✅ [POLL] Enough players! (${currentPlayers}/${config.minPlayersToStart})`);
                    timerManager.clearInterval(`poll_${roomId}`);
                    await this.startGame(roomId, updated, config);
                } else if (currentPlayers === 0 && config.resetOnNoPlayers) {
                    log(`\n🔄 [POLL] All players left, resetting`);
                    timerManager.clearInterval(`poll_${roomId}`);
                    updated.timerStartedAt = new Date();
                    await updated.save();
                    this.io.to(roomId).emit('countdownReset', { timerStartedAt: updated.timerStartedAt });
                    this.startCountdown(roomId, updated, config);
                }
            } catch (e) {
                logError(`❌ [POLL] Error:`, e);
            }
        }, 3000, 'player_poll');
    }
    // Add this method to GameEngine class
async verifyAndFixGame(roomId) {
    const game = await Game.getActiveGame(roomId);
    if (!game) return { error: 'No active game' };
    
    console.log(`\n🔍 [VERIFY] Game #${game.gameNumber}`);
    
    const cards = await Card.find({ 
        gameId: game._id, 
        status: 'registered' 
    });
    
    const calculatedTotalCards = cards.length;
    const calculatedPrizePool = cards.reduce((sum, card) => sum + card.price, 0);
    const uniquePlayers = new Set(cards.map(c => c.userId.toString()));
    const calculatedPlayerCount = uniquePlayers.size;
    
    console.log(`   Cards: ${calculatedTotalCards}, Pool: ${calculatedPrizePool} ETB, Players: ${calculatedPlayerCount}`);
    console.log(`   Stored: totalCards=${game.totalCards}, pool=${game.prizePool}, players=${game.players?.length}`);
    
    let needsFix = false;
    
    if (game.totalCards !== calculatedTotalCards) {
        console.log(`   ⚠️ Fixing totalCards: ${game.totalCards} → ${calculatedTotalCards}`);
        game.totalCards = calculatedTotalCards;
        needsFix = true;
    }
    
    if (game.prizePool !== calculatedPrizePool) {
        console.log(`   ⚠️ Fixing prizePool: ${game.prizePool} → ${calculatedPrizePool}`);
        game.prizePool = calculatedPrizePool;
        needsFix = true;
    }
    
    if (game.players?.length !== calculatedPlayerCount) {
        const playerMap = new Map();
        for (const card of cards) {
            const uid = card.userId.toString();
            if (!playerMap.has(uid)) playerMap.set(uid, []);
            playerMap.get(uid).push(card._id);
        }
        game.players = Array.from(playerMap.entries()).map(([userId, cardIds]) => ({
            userId, cards: cardIds
        }));
        needsFix = true;
    }
    
    if (needsFix) {
        await game.save();
        console.log(`   ✅ Fixed!`);
        this.io.to(roomId).emit('gameStateCorrected', {
            totalCards: game.totalCards,
            prizePool: game.prizePool,
            playerCount: game.players.length
        });
    } else {
        console.log(`   ✅ All correct`);
    }
    
    return { totalCards: game.totalCards, prizePool: game.prizePool, playerCount: game.players.length, needsFix };
}

    async startGame(roomId, game, config) {
        divider();
        log(`\n🚀 *** GAME #${game.gameNumber} STARTING! ***`);
        log(`   Players: ${this.getPlayerCount(game)}`);
        log(`   Total cards: ${game.totalCards}`);
        log(`   Prize pool: ${game.prizePool} ETB`);
        log(`   Card price: ${config.cardPrice} ETB`);
        log(`   Commission: ${config.commissionPercentage || 10}%`);
        log(`   Expected winners prize: ${game.prizePool * (1 - (config.commissionPercentage || 10) / 100)} ETB`);
        divider();
          await this.verifyAndFixGame(roomId);
    const verifiedGame = await Game.findById(game._id);
    
    console.log(`\n🚀 *** GAME #${verifiedGame.gameNumber} STARTING! ***`);
    console.log(`   Players: ${this.getPlayerCount(verifiedGame)}`);
    console.log(`   Total cards: ${verifiedGame.totalCards}`);
    console.log(`   Prize pool: ${verifiedGame.prizePool} ETB`);
    console.log(`   Expected prize: ${verifiedGame.prizePool * (1 - (config?.commissionPercentage || 10) / 100)} ETB`);
        
        timerManager.clearInterval(`poll_${roomId}`);
        game.status = 'in_progress';
        game.startTime = new Date();
        await game.save();
        
        this.io.to(roomId).emit('gameStarted', { 
            gameId: game.gameId, 
            gameNumber: game.gameNumber, 
            prizePool: game.prizePool, 
            playerCount: this.getPlayerCount(game), 
            totalCards: game.totalCards 
        });
        
        this.drawNumbers(roomId, game, config);
    }

    drawNumbers(roomId, game, config) {
        log(`\n🎯 [DRAW] Starting number draws - Interval: ${config.drawIntervalSeconds}s`);
        let idx = 0;
        timerManager.clearInterval(`draw_${roomId}`);
        
        timerManager.createInterval(`draw_${roomId}`, async () => {
            const current = await Game.findById(game._id);
            if (!current || current.status === 'completed' || current.status === 'grace_period') { 
                timerManager.clearInterval(`draw_${roomId}`); 
                return; 
            }
            
            if (idx >= current.allNumbers.length) {
                log(`\n🏁 [DRAW] All numbers drawn! Ending game #${current.gameNumber}`);
                timerManager.clearInterval(`draw_${roomId}`);
                await this.endGame(roomId, current);
                return;
            }
            
            const activeCards = await Card.countDocuments({
                gameId: current._id, status: 'registered',
                isBlocked: false, bingoCalled: false
            });
            
            if (activeCards === 0 && current.totalCards > 0) {
                log(`\n🚫 [DRAW] All cards blocked! Ending game #${current.gameNumber}`);
                timerManager.clearInterval(`draw_${roomId}`);
                
                const cards = await Card.find({ gameId: current._id, status: 'registered' });
                log(`   Refunding ${cards.length} cards...`);
                
                for (const card of cards) {
                    const user = await User.findById(card.userId);
                    if (user) {
                        user.walletBalance += card.price;
                        await user.save();
                        await Transaction.create({
                            userId: user._id, type: 'refund', amount: card.price,
                            gameId: current.gameId, gameNumber: current.gameNumber,
                            description: `Refund - all cards blocked in Game #${current.gameNumber}`,
                            balanceAfter: user.walletBalance
                        });
                        await this.sendRefundNotification(user._id, card.price, current.gameNumber, 'All cards blocked - refunded');
                    }
                }
                
                current.status = 'completed';
                current.endTime = new Date();
                current.endReason = 'all_cards_blocked';
                await current.save();
                
                this.io.to(roomId).emit('gameEnded', { 
                    gameId: current._id, winners: [], 
                    prizePool: current.prizePool,
                    reason: 'All cards blocked - refunded', refunded: true 
                });
                
                setTimeout(async () => {
                    const conf = await GameConfig.findOne({ roomId });
                    if (conf) {
                        const ln = await Game.getLatestGameNumber(roomId);
                        const ng = await Game.create({
                            gameId: String(ln + 1).padStart(10, '0'),
                            gameNumber: ln + 1, roomId, status: 'scheduled',
                            allNumbers: this.shuffleNumbers(),
                            timerDuration: conf.waitTimeSeconds
                        });
                        this.games.set(roomId, ng);
                        this.io.to(roomId).emit('newGameCreated', { gameId: ng.gameId, gameNumber: ng.gameNumber });
                    }
                }, 5000);
                return;
            }
            
            const num = current.allNumbers[idx], letter = this.getBingoLetter(num);
            current.currentNumber = { number: num, letter };
            current.drawnNumbers.push({ number: num, letter });
            await current.save();
            
            if (idx % 10 === 0 || idx === current.allNumbers.length - 1) {
                log(`🎯 [DRAW] #${idx + 1}: ${letter}${num} (${activeCards} active cards)`);
            }
            
            this.io.to(roomId).emit('numberDrawn', { 
                number: num, letter, drawCount: idx + 1, 
                totalNumbers: current.allNumbers.length 
            });
            idx++;
        }, config.drawIntervalSeconds * 1000, 'number_draw');
    }

    // ============================================
    // WIN CHECKING
    // ============================================
    checkWin(card, drawnNumbers, config) {
        const drawnSet = new Set(drawnNumbers.map(d => d.number));
        const cols = ['B', 'I', 'N', 'G', 'O'];
        
        if (config?.isLastNumberCalledBingo && drawnNumbers.length > 0) {
            const lastCalled = drawnNumbers[drawnNumbers.length - 1];
            const lastCell = card.grid[lastCalled.letter]?.find(c => c.number === lastCalled.number);
            if (!lastCell) return null;
        }
        
        // Check rows
        for (let r = 0; r < 5; r++) { 
            let ok = true; 
            for (let c of cols) { 
                if (!(c === 'N' && r === 2) && !drawnSet.has(card.grid[c][r].number)) { 
                    ok = false; break; 
                } 
            } 
            if (ok) return 'line'; 
        }
        
        // Check columns
        for (let c of cols) { 
            let ok = true; 
            for (let r = 0; r < 5; r++) { 
                if (!(c === 'N' && r === 2) && !drawnSet.has(card.grid[c][r].number)) { 
                    ok = false; break; 
                } 
            } 
            if (ok) return 'line'; 
        }
        
        // Check diagonals
        let d1 = true, d2 = true;
        for (let i = 0; i < 5; i++) { 
            if (!(cols[i] === 'N' && i === 2) && !drawnSet.has(card.grid[cols[i]][i].number)) d1 = false; 
            if (!(cols[4-i] === 'N' && i === 2) && !drawnSet.has(card.grid[cols[4-i]][i].number)) d2 = false; 
        }
        if (d1 || d2) return 'line';
        
        // Four corners
        if (drawnSet.has(card.grid.B[0].number) && drawnSet.has(card.grid.O[0].number) && 
            drawnSet.has(card.grid.B[4].number) && drawnSet.has(card.grid.O[4].number)) 
            return 'four_corners';
        
        return null;
    }

    // ============================================
    // BINGO CALLING
    // ============================================
    async callBingo(roomId, userId, cardId) {
        divider();
        log(`\n🎉 [BINGO CALL] User: ${userId}, Card: ${cardId}, Room: ${roomId}`);
        
        const game = await Game.getActiveGame(roomId);
        if (!game || (game.status !== 'in_progress' && game.status !== 'bingo_called')) {
            logError(`❌ Game not in progress. Status: ${game?.status}`);
            throw new Error('Game not in progress');
        }
        log(`   Game: #${game.gameNumber}, Status: ${game.status}, Drawn: ${game.drawnNumbers?.length || 0} numbers`);
        
        const card = await Card.findOne({ _id: cardId, userId, gameId: game._id, status: 'registered' });
        if (!card || card.isBlocked) {
            logError(`❌ Card not valid or blocked`);
            throw new Error('Card not valid');
        }
        if (card.bingoCalled) {
            logError(`❌ Bingo already called on this card`);
            throw new Error('Bingo already called');
        }
        
        const config = await GameConfig.findOne({ roomId });
        const lastCalled = game.drawnNumbers?.[game.drawnNumbers.length - 1];
        
        if (config?.isLastNumberCalledBingo && lastCalled) {
            const lastCell = card.grid[lastCalled.letter]?.find(c => c.number === lastCalled.number);
            if (!lastCell) {
                log(`❌ FALSE BINGO: Last number ${lastCalled.letter}${lastCalled.number} not on card`);
                card.isBlocked = true;
                card.blockReason = 'Last number not on card';
                await card.save();
                this.io.to(roomId).emit('falseBingo', {
                    userId, cardId, cardNumber: card.cardNumber,
                    reason: `Last number ${lastCalled.letter}${lastCalled.number} not on card`
                });
                return { success: false, falseBingo: true, reason: 'last_number_not_on_card' };
            }
        }
        
        const winType = this.checkWin(card, game.drawnNumbers);
        
        if (!winType) {
            log(`❌ FALSE BINGO: No winning pattern`);
            card.isBlocked = true;
            card.blockReason = 'no_win';
            await card.save();
            this.io.to(roomId).emit('falseBingo', { userId, cardId, cardNumber: card.cardNumber, reason: 'no_win' });
            return { success: false, falseBingo: true, reason: 'no_win' };
        }
        
        log(`✅ VALID BINGO! Type: ${winType}`);
        
        // Auto-mark winning numbers
        const drawnSet = new Set(game.drawnNumbers.map(d => d.number));
        for (let c of ['B', 'I', 'N', 'G', 'O']) {
            for (let cell of card.grid[c]) {
                if (drawnSet.has(cell.number) && !cell.isMarked && cell.number > 0) {
                    cell.isMarked = true;
                }
            }
        }
        
        card.bingoCalled = true;
        card.bingoCallTime = new Date();
        card.winType = winType;
        await card.save();
        
        if (game.status === 'in_progress') {
            log(`🥇 FIRST BINGO! Starting grace period...`);
            timerManager.clearInterval(`draw_${roomId}`);
            game.status = 'bingo_called';
            game.gracePeriodEndTime = new Date(Date.now() + 10000);
            await game.save();
            this.io.to(roomId).emit('firstBingo', { userId, cardId, cardNumber: card.cardNumber, winType });
            timerManager.createTimeout(`grace_${roomId}`, () => this.endGracePeriod(roomId, game._id), 10000, 'grace_period');
        } else {
            log(`🎉 Additional BINGO!`);
            await game.save();
            this.io.to(roomId).emit('additionalBingo', { userId, cardId, cardNumber: card.cardNumber, winType });
        }
        
        divider();
        return { success: true, winType };
    }

    // ============================================
    // GRACE PERIOD & END GAME
    // ============================================
    async endGracePeriod(roomId, gameId) {
        divider();
        log(`\n⏰ [GRACE PERIOD END] Game: ${gameId}, Room: ${roomId}`);
        
        const game = await Game.findById(gameId);
        if (!game || game.status === 'completed') {
            log(`   Game already completed`);
            return;
        }
        
        const config = await GameConfig.findOne({ roomId: game.roomId });
        const calledCards = await Card.find({ 
            gameId: game._id, bingoCalled: true, isBlocked: false 
        }).populate('userId');
        
        log(`   Called cards: ${calledCards.length}`);
        log(`   Prize pool: ${game.prizePool} ETB`);
        log(`   Commission: ${config?.commissionPercentage || 10}%`);
        
        const winners = [];
        for (const card of calledCards) { 
            const wt = this.checkWin(card, game.drawnNumbers); 
            if (wt) { 
                card.bingoValidated = true; 
                await card.save(); 
                winners.push({ card, winType: wt }); 
            }
        }
        
        log(`   Validated winners: ${winners.length}`);
        
        if (winners.length > 0) { 
            const commissionRate = config?.commissionPercentage || 10;
            const comm = (game.prizePool * commissionRate) / 100;
            const ppw = (game.prizePool - comm) / winners.length;
            
            log(`\n💰 PRIZE CALCULATION:`);
            log(`   Prize pool: ${game.prizePool} ETB`);
            log(`   Commission (${commissionRate}%): ${comm} ETB`);
            log(`   Prize per winner: ${ppw} ETB`);
            log(`   Total payout: ${ppw * winners.length} ETB`);
            
            for (const { card, winType } of winners) { 
                const user = card.userId;
                const oldBalance = user.walletBalance || 0;
                await User.findByIdAndUpdate(user._id, { $inc: { walletBalance: ppw } });
                const updatedUser = await User.findById(user._id);
                
                log(`   🏆 Winner: ${user.fullName} - ${oldBalance} → ${updatedUser.walletBalance} (+${ppw} ETB) - ${winType}`);
                
                await Transaction.create({ 
                    userId: user._id, type: 'prize_win', amount: ppw, 
                    gameId: game.gameId, gameNumber: game.gameNumber, 
                    description: `Won with ${winType}`, 
                    balanceAfter: updatedUser.walletBalance 
                });
                
                game.winners.push({
                    userId: user._id,
                    cardId: card._id,
                    winType,
                    prizeAmount: ppw,
                    winnerName: user.fullName,
                    winnerPhone: user.phone,
                    cardNumber: card.cardNumber,
                    cardGrid: card.grid,
                    newBalance: updatedUser.walletBalance  // 🔥 ADD THIS
                });
                
                await this.sendWinningNotification(user._id, ppw, game.gameNumber, winType);
            }
            
            await Transaction.create({ 
                type: 'commission', amount: comm, 
                gameId: game.gameId, gameNumber: game.gameNumber, 
                description: 'Commission' 
            }); 
            game.commission = comm;
            
            log(`\n📡 Emitting gameEnded with winners and balances`);
        } else {
            log(`   No valid winners found`);
        }
        
        game.status = 'completed'; 
        game.endTime = new Date(); 
        await game.save();
        
        timerManager.clearInterval(`draw_${roomId}`); 
        timerManager.clearTimeout(`grace_${roomId}`);
        
        this.io.to(roomId).emit('gameEnded', { 
            gameId: game._id, 
            winners: game.winners, 
            prizePool: game.prizePool, 
            commission: game.commission,
            // 🔥 Send first winner's balance (client can use this)
            balance: game.winners[0]?.newBalance || 0
        });
        
        log(`✅ Game #${game.gameNumber} completed`);
        divider();
        
        setTimeout(async () => { 
            const conf = await GameConfig.findOne({ roomId: game.roomId }); 
            if (conf) { 
                const ln = await Game.getLatestGameNumber(roomId); 
                const ng = await Game.create({ 
                    gameId: String(ln + 1).padStart(10, '0'), 
                    gameNumber: ln + 1, roomId, status: 'scheduled', 
                    allNumbers: this.shuffleNumbers(), 
                    timerDuration: conf.waitTimeSeconds 
                }); 
                this.games.set(roomId, ng); 
                this.io.to(roomId).emit('newGameCreated', { 
                    gameId: ng.gameId, gameNumber: ng.gameNumber 
                }); 
                log(`🆕 New game #${ng.gameNumber} created`);
            } 
        }, 5000);
    }

    async endGame(roomId, game) {
        divider();
        log(`\n🏁 [END GAME] Game #${game.gameNumber} - No winner`);
        log(`   Prize pool: ${game.prizePool} ETB`);
        
        game.status = 'completed';
        game.endTime = new Date();
        game.endReason = game.endReason || 'all_numbers_drawn';
        await game.save();
        
        timerManager.clearInterval(`draw_${roomId}`);
        
        const cards = await Card.find({ gameId: game._id, status: 'registered' });
        let totalRefunded = 0;
        
        log(`   Refunding ${cards.length} cards...`);
        
        for (const card of cards) {
            const user = await User.findById(card.userId);
            if (user) {
                const oldBalance = user.walletBalance;
                user.walletBalance += card.price;
                await user.save();
                totalRefunded += card.price;
                
                log(`   💰 ${user.fullName}: ${oldBalance} → ${user.walletBalance} (+${card.price})`);
                
                await Transaction.create({
                    userId: user._id,
                    type: 'refund',
                    amount: card.price,
                    gameId: game.gameId,
                    gameNumber: game.gameNumber,
                    description: `Refund - no winner in Game #${game.gameNumber}`,
                    balanceAfter: user.walletBalance
                });
                await this.sendRefundNotification(user._id, card.price, game.gameNumber, 'No winner - refunded');
            }
        }
        
        log(`\n💰 Total refunded: ${totalRefunded} ETB to ${cards.length} cards`);
        
        this.io.to(roomId).emit('gameEnded', { 
            gameId: game._id, 
            winners: [], 
            prizePool: game.prizePool,
            reason: 'No winner - all refunded',
            refunded: true,
            totalRefunded,
            balance: totalRefunded > 0 ? undefined : 0 // Balance unchanged on refund
        });
        
        divider();
        
        setTimeout(async () => {
            const conf = await GameConfig.findOne({ roomId: game.roomId });
            if (conf) {
                const ln = await Game.getLatestGameNumber(game.roomId);
                const ng = await Game.create({
                    gameId: String(ln + 1).padStart(10, '0'),
                    gameNumber: ln + 1,
                    roomId: game.roomId,
                    status: 'scheduled',
                    allNumbers: this.shuffleNumbers(),
                    timerDuration: conf.waitTimeSeconds
                });
                this.games.set(game.roomId, ng);
                this.io.to(game.roomId).emit('newGameCreated', { 
                    gameId: ng.gameId, 
                    gameNumber: ng.gameNumber 
                });
                log(`🆕 New game #${ng.gameNumber} created`);
            }
        }, 5000);
    }

    async getGameState(roomId, userId) {
        const game = await Game.getActiveGame(roomId); 
        if (!game) {
            log(`📊 [getGameState] No active game for room ${roomId}`);
            return null;
        }
        
        const config = await GameConfig.findOne({ roomId });
        const myCards = userId ? await Card.find({ gameId: game._id, userId, status: 'registered' }) : [];
        const previewCards = userId ? await Card.find({ gameId: game._id, userId, status: 'preview' }) : [];
        const user = userId ? await User.findById(userId).select('walletBalance') : null;
        
        const state = { 
            gameId: game.gameId, 
            gameNumber: game.gameNumber, 
            status: game.status, 
            playerCount: this.getPlayerCount(game), 
            totalCards: game.totalCards, 
            prizePool: game.prizePool, 
            currentNumber: game.currentNumber, 
            drawnNumbers: game.drawnNumbers, 
            drawCount: game.drawnNumbers?.length || 0, 
            timeRemaining: this.getTimeRemaining(game), 
            timerDuration: game.timerDuration, 
            timerStartedAt: game.timerStartedAt, 
            config: { 
                cardPrice: config?.cardPrice, 
                maxCardsPerPlayer: config?.maxCardsPerPlayer, 
                minPlayersToStart: config?.minPlayersToStart, 
                commissionPercentage: config?.commissionPercentage || 10, // 🔥 Default to 10
                waitTimeSeconds: config?.waitTimeSeconds, 
                drawIntervalSeconds: config?.drawIntervalSeconds 
            }, 
            myCards, 
            myCardsCount: myCards.length, 
            previewCards, 
            previewCardsCount: previewCards.length, 
            winners: game.winners, 
            balance: user?.walletBalance || 0 
        };
        
        log(`📊 [getGameState] Game #${game.gameNumber} - totalCards: ${game.totalCards}, prizePool: ${game.prizePool}, commission: ${state.config.commissionPercentage}%`);
        
        return state;
    }

    getTimeRemaining(game) { 
        if (!game.timerStartedAt) return game.timerDuration; 
        const elapsed = (Date.now() - game.timerStartedAt.getTime()) / 1000; 
        return Math.max(0, game.timerDuration - elapsed); 
    }
}

module.exports = GameEngine;