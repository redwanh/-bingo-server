const Game = require('../models/Game');
const GameConfig = require('../models/GameConfig');
const Card = require('../models/Card');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Notification = require('../models/Notification');
const timerManager = require('../utils/TimerManager');

class GameEngine {
    constructor(io) {
        this.io = io;
        this.userSockets = new Map();
        this.games = new Map();
        this.activeGames = new Set();
    }

    setUserSocket(userId, socketId) { this.userSockets.set(userId.toString(), socketId); }
    removeUserSocket(userId) { this.userSockets.delete(userId.toString()); }
    getUserSocket(userId) {
        const socketId = this.userSockets.get(userId.toString());
        if (socketId) return this.io.sockets.sockets.get(socketId);
        return null;
    }
    cleanup() { timerManager.reportStats(); }

    // ============================================
    // CRITICAL: Get player count FROM THE ARRAY
    // ============================================
    getPlayerCount(game) {
        if (!game) return 0;
        if (!game.players) return 0;
        if (!Array.isArray(game.players)) return 0;
        return game.players.length;
    }

    // ============================================
    // NOTIFICATIONS (shortened for brevity - keep your existing ones)
    // ============================================
    async sendNotification(userId, data) {
        try {
            const notification = await Notification.create({
                user: userId, type: data.type || 'system',
                title: data.title, titleAm: data.titleAm, titleTg: data.titleTg,
                message: data.message, messageAm: data.messageAm, messageTg: data.messageTg,
                priority: data.priority || 'normal', amount: data.amount,
                expiresAt: data.expiresAt || new Date(Date.now() + 7*24*60*60*1000)
            });
            const socket = this.getUserSocket(userId);
            if (socket) socket.emit('newNotification', notification);
            return notification;
        } catch (e) { return null; }
    }
    async sendRefundNotification(uid, amt, gn, reason) {
        return this.sendNotification(uid, { type:'refund', title:'Refund Processed', titleAm:'ተመላሽ ገንዘብ ተከፍሏል', titleTg:'ገንዘብ ተመላሽ ተደርጓል', message:`Your ${amt} ETB refunded for Game #${gn}. ${reason}`, messageAm:`${amt} ብር ለጨዋታ #${gn} ተመላሽ ተደርጓል።`, messageTg:`ናይ ${amt} ብር ንጸወታ #${gn} ተመሊሱ።`, priority:'high', amount:amt });
    }
    async sendGameCancelledNotification(uid, gn) {
        return this.sendNotification(uid, { type:'game_cancelled', title:'Game Cancelled', titleAm:'ጨዋታ ተሰርዟል', titleTg:'ጸወታ ተሰሪዙ', message:`Game #${gn} interrupted. Cards refunded.`, messageAm:`ጨዋታ #${gn} ተቋርጧል።`, messageTg:`ጸወታ #${gn} ተቋሪጹ።`, priority:'high' });
    }
    async sendWinningNotification(uid, amt, gn, wt) {
        return this.sendNotification(uid, { type:'winning', title:'You Won!', titleAm:'አሸንፈዋል!', titleTg:'ተዓዊትኩም!', message:`You won ${amt} ETB in Game #${gn} (${wt})!`, messageAm:`${amt} ብር አሸንፈዋል (${wt})!`, messageTg:`${amt} ብር ተዓዊትኩም (${wt})!`, priority:'high', amount:amt });
    }

    // ============================================
    // REFUND LOGIC (keep your existing)
    // ============================================
    async refundGame(gameId, reason = 'server_interruption') {
        const game = await Game.findById(gameId);
        if (!game) throw new Error('Game not found');
        const cards = await Card.find({ gameId: game._id, status: 'registered' });
        const stats = { totalCards: cards.length, totalAmount: 0, successfulRefunds: 0, failedRefunds: 0, refundedUsers: new Set() };
        for (const card of cards) {
            try { await this.refundSingleCard(card, game, reason, stats); }
            catch (e) { stats.failedRefunds++; }
        }
        game.status = 'completed'; game.endTime = new Date(); game.endReason = reason;
        game.refundStats = { totalRefunded: stats.totalAmount, cardsRefunded: stats.successfulRefunds, usersRefunded: stats.refundedUsers.size };
        await game.save();
        return stats;
    }
    async refundSingleCard(card, game, reason, stats) {
        const user = await User.findById(card.userId);
        if (!user) return;
        const amt = card.price || 0;
        user.walletBalance += amt; await user.save();
        await Transaction.create({ userId:user._id, type:'refund', amount:amt, gameId:game.gameId, gameNumber:game.gameNumber, description:`Refund Game #${game.gameNumber}`, balanceAfter:user.walletBalance, cardId:card._id });
        card.status = 'refunded'; card.refundedAt = new Date(); card.refundReason = reason; await card.save();
        await this.sendRefundNotification(user._id, amt, game.gameNumber, reason);
        stats.totalAmount += amt; stats.successfulRefunds++; stats.refundedUsers.add(user._id.toString());
    }

    // ============================================
    // CRASH RECOVERY
    // ============================================
    async recoverFromCrash() {
        console.log('\n=== CRASH RECOVERY ===\n');
        const stuckGames = await Game.find({ status: { $in: ['in_progress','bingo_called','waiting','scheduled'] }, updatedAt: { $lt: new Date(Date.now()-30000) } });
        console.log(`Found ${stuckGames.length} stuck games\n`);
        for (const game of stuckGames) await this.decideAndRecover(game);
        console.log('\nRecovery complete\n');
    }
    async decideAndRecover(game) {
        const pc = this.getPlayerCount(game);
        console.log(`Game #${game.gameNumber} - Status:${game.status} Players:${pc}`);
        if (await this.shouldRefundGame(game)) { await this.refundAndRestart(game); }
        else { await this.recoverAndResume(game); }
    }
    async shouldRefundGame(game) {
        const config = await GameConfig.findOne({ roomId: game.roomId });
        if (game.status==='waiting'||game.status==='scheduled') {
            if (config&&game.timerStartedAt) {
                const elapsed = (Date.now()-game.timerStartedAt.getTime())/1000;
                if (elapsed > Math.max(config.waitTimeSeconds*3,120)) return true;
            }
            return false;
        }
        if (Date.now()-game.updatedAt > 600000) return true;
        if (game.drawnNumbers&&game.drawnNumbers.length<5) return true;
        return false;
    }
    async refundAndRestart(game) {
        const stats = await this.refundGame(game._id, 'server_interruption');
        this.io.to(game.roomId).emit('gameCancelled', { gameNumber:game.gameNumber });
        await this.createNewGameAfterDelay(game.roomId, 3000);
    }
    async recoverAndResume(game) {
        const config = await GameConfig.findOne({ roomId: game.roomId });
        if (!config) { await this.refundAndRestart(game); return; }
        this.games.set(game.roomId, game);
        switch(game.status) {
            case 'scheduled': case 'waiting': await this.recoverWaitingGame(game, config); break;
            case 'in_progress': await this.recoverRunningGame(game, config); break;
            case 'bingo_called': await this.recoverGracePeriod(game, config); break;
        }
    }
    async recoverWaitingGame(game, config) {
        const pc = this.getPlayerCount(game);
        const elapsed = game.timerStartedAt ? (Date.now()-game.timerStartedAt.getTime())/1000 : 0;
        const tr = Math.max(0, config.waitTimeSeconds-elapsed);
        if (tr<=0 && pc>=config.minPlayersToStart) { await this.startGame(game.roomId, game, config); }
        else if (tr<=0) { this.startPlayerPoll(game.roomId, game, config); }
        else { this.startCountdown(game.roomId, game, config); }
    }
    async recoverRunningGame(game, config) {
        let idx = game.drawnNumbers.length;
        timerManager.createInterval(`draw_${game.roomId}`, async () => {
            const current = await Game.findById(game._id);
            if (!current||current.status==='completed'||current.status==='grace_period') { timerManager.clearInterval(`draw_${game.roomId}`); return; }
            if (idx>=current.allNumbers.length) { timerManager.clearInterval(`draw_${game.roomId}`); await this.endGame(game.roomId, current); return; }
            const num = current.allNumbers[idx], letter = this.getBingoLetter(num);
            current.currentNumber = { number:num, letter }; current.drawnNumbers.push({ number:num, letter }); await current.save();
            this.io.to(game.roomId).emit('numberDrawn', { number:num, letter, drawCount:idx+1 });
            idx++;
        }, config.drawIntervalSeconds*1000, 'number_draw');
    }
    async recoverGracePeriod(game, config) {
        const ge = game.gracePeriodEndTime ? (Date.now()-game.gracePeriodEndTime.getTime())/1000 : 999;
        if (ge>=0) { await this.endGracePeriod(game.roomId, game._id); }
        else { timerManager.createTimeout(`grace_${game.roomId}`, ()=>this.endGracePeriod(game.roomId,game._id), Math.abs(ge)*1000, 'grace_period'); }
    }
    async createNewGameAfterDelay(roomId, delay) {
        return new Promise(resolve => setTimeout(async () => {
            const config = await GameConfig.findOne({ roomId, isActive:true });
            if (!config) { resolve(false); return; }
            const lastNum = await Game.getLatestGameNumber(roomId);
            const newGame = await Game.create({ gameId:String(lastNum+1).padStart(10,'0'), gameNumber:lastNum+1, roomId, status:'scheduled', allNumbers:this.shuffleNumbers(), timerDuration:config.waitTimeSeconds });
            this.games.set(roomId, newGame);
            this.io.to(roomId).emit('newGameCreated', { gameId:newGame.gameId, gameNumber:newGame.gameNumber });
            resolve(true);
        }, delay));
    }

    async initializeRoom(roomId) {
        const config = await GameConfig.findOne({ roomId, isActive:true });
        if (!config) return null;
        let game = await Game.getActiveGame(roomId);
        if (!game) {
            const lastNum = await Game.getLatestGameNumber(roomId);
            game = await Game.create({ gameId:String(lastNum+1).padStart(10,'0'), gameNumber:lastNum+1, roomId, status:'scheduled', allNumbers:this.shuffleNumbers(), timerDuration:config.waitTimeSeconds });
        }
        this.games.set(roomId, game);
        return game;
    }

    shuffleNumbers() { const n=[]; for(let i=1;i<=75;i++)n.push(i); for(let i=n.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[n[i],n[j]]=[n[j],n[i]];} return n; }
    getBingoLetter(n) { if(n<=15)return'B';if(n<=30)return'I';if(n<=45)return'N';if(n<=60)return'G';return'O'; }
    generateGrid() { const c={B:this.genCol(1,15),I:this.genCol(16,30),N:this.genCol(31,45),G:this.genCol(46,60),O:this.genCol(61,75)}; c.N[2]={number:0,isMarked:true}; return c; }
    genCol(min,max){const s=new Set();while(s.size<5)s.add(Math.floor(Math.random()*(max-min+1))+min);return Array.from(s).map(n=>({number:n,isMarked:false}));}

    async buyCard(roomId, userId) {
        const game = await Game.getActiveGame(roomId);
        if (!game||(game.status!=='scheduled'&&game.status!=='waiting')) throw new Error('Game not available');
        const config = await GameConfig.findOne({ roomId });
        if (!config) throw new Error('Config not found');
        const player = game.players.find(p=>p.userId.toString()===userId);
        const cc = player?.cards?.length||0;
        if (cc>=config.maxCardsPerPlayer) throw new Error(`Max ${config.maxCardsPerPlayer} cards`);
        const user = await User.findById(userId);
        if (user.walletBalance<config.cardPrice) throw new Error(`Need ${config.cardPrice} coins`);
        user.walletBalance-=config.cardPrice; await user.save();
        const card = await Card.create({ gameId:game._id, userId, cardNumber:game.totalCards+1, grid:this.generateGrid(), price:config.cardPrice, status:'registered' });
        if(!player) game.players.push({userId,cards:[card._id]});
        else player.cards.push(card._id);
        game.totalCards+=1; game.prizePool+=config.cardPrice;
        await Transaction.create({ userId, type:'card_purchase', amount:-config.cardPrice, gameId:game.gameId, gameNumber:game.gameNumber, description:`Card #${card.cardNumber}`, balanceAfter:user.walletBalance });
        if(game.players.length===1&&!game.timerStartedAt){game.timerStartedAt=new Date();game.status='waiting';this.startCountdown(roomId,game,config);}
        await game.save();
        this.io.to(roomId).emit('cardPurchased',{userId,totalCards:game.totalCards,playerCount:game.players.length,prizePool:game.prizePool,timerStartedAt:game.timerStartedAt,timerDuration:game.timerDuration});
        return {success:true,card,newBalance:user.walletBalance,cardsOwned:cc+1};
    }

    async previewCard(roomId, userId) {
        const game = await Game.getActiveGame(roomId);
        if (!game||(game.status!=='scheduled'&&game.status!=='waiting')) throw new Error('Game not available');
        const config = await GameConfig.findOne({ roomId });
        const rc = await Card.countDocuments({gameId:game._id,userId,status:'registered'});
        if (rc>=config.maxCardsPerPlayer) throw new Error(`Max ${config.maxCardsPerPlayer} cards`);
        const card = await Card.create({ gameId:game._id, userId, cardNumber:game.totalCards+1, grid:this.generateGrid(), price:config.cardPrice, status:'preview' });
        const sock = this.getUserSocket(userId);
        if(sock) sock.emit('previewCardGenerated',{userId,card});
        return {success:true,card};
    }

    async registerCard(roomId, userId, cardId) {
        const game = await Game.getActiveGame(roomId);
        if (!game||(game.status!=='scheduled'&&game.status!=='waiting')) throw new Error('Game not available');
        const config = await GameConfig.findOne({ roomId });
        const card = await Card.findOne({_id:cardId,gameId:game._id,userId,status:'preview'});
        if(!card) throw new Error('Card not found');
        const user = await User.findById(userId);
        if(user.walletBalance<card.price) throw new Error(`Need ${card.price} ETB`);
        const ug = await Game.findOneAndUpdate({_id:game._id,status:{$in:['scheduled','waiting']}},{$inc:{totalCards:1,prizePool:card.price},$set:{timerStartedAt:game.players.length===0?new Date():game.timerStartedAt,status:game.players.length===0?'waiting':game.status}},{new:true});
        if(!ug) throw new Error('Game update failed');
        card.status='registered';card.cardNumber=ug.totalCards;card.registeredAt=new Date();await card.save();
        const pi = ug.players.findIndex(p=>p.userId.toString()===userId);
        if(pi===-1) ug.players.push({userId,cards:[card._id]});
        else ug.players[pi].cards.push(card._id);
        await ug.save();
        user.walletBalance-=card.price;await user.save();
        await Transaction.create({userId,type:'card_purchase',amount:-card.price,gameId:ug.gameId,gameNumber:ug.gameNumber,description:`Card #${card.cardNumber}`,balanceAfter:user.walletBalance,cardId:card._id});
       if(ug.players.length===1) {
    console.log(`[REGISTER] First player! Starting countdown...`);
    this.startCountdown(roomId, ug, config);
}
        this.io.to(roomId).emit('cardRegistered',{userId,cardId:card._id,cardNumber:card.cardNumber,totalCards:ug.totalCards,playerCount:ug.players.length,prizePool:ug.prizePool,timerStartedAt:ug.timerStartedAt,timerDuration:ug.timerDuration});
        const sock=this.getUserSocket(userId);
        if(sock)sock.emit('balanceUpdated',{newBalance:user.walletBalance,cardNumber:card.cardNumber});
        return {success:true,cardNumber:card.cardNumber,newBalance:user.walletBalance};
    }

    async cancelPreviewCard(roomId, userId, cardId) {
        await Card.deleteOne({_id:cardId,userId,status:'preview'});
        const sock=this.getUserSocket(userId);
        if(sock)sock.emit('previewCardCancelled',{userId,cardId});
        return {success:true};
    }

    // ============================================
    // THE CRITICAL FIX - GAME START LOGIC
    // ============================================
    
    startCountdown(roomId, game, config) {
        console.log(`[TIMER] Countdown started - ${config.waitTimeSeconds}s`);
        timerManager.clearTimeout(`countdown_${roomId}`);
        timerManager.clearInterval(`poll_${roomId}`);
        
        timerManager.createTimeout(`countdown_${roomId}`, async () => {
            try {
                const current = await Game.findById(game._id);
                if (!current || current.status === 'completed') return;
                
                // CRITICAL: Log what we actually have
                console.log(`[TIMER] EXPIRED! Game #${current.gameNumber}`);
                console.log(`[TIMER] players type: ${typeof current.players}, isArray: ${Array.isArray(current.players)}`);
                console.log(`[TIMER] players value:`, JSON.stringify(current.players));
                
                const playerCount = current.players ? current.players.length : 0;
                console.log(`[TIMER] Player count: ${playerCount}, Need: ${config.minPlayersToStart}`);
                
                if (playerCount >= config.minPlayersToStart) {
                    console.log(`[TIMER] *** STARTING GAME! ***`);
                    await this.startGame(roomId, current, config);
                } else if (playerCount === 0 && config.resetOnNoPlayers) {
                    console.log(`[TIMER] No players, resetting`);
                    current.timerStartedAt = new Date();
                    current.status = 'waiting';
                    await current.save();
                    this.io.to(roomId).emit('countdownReset', { timerStartedAt: current.timerStartedAt, timerDuration: config.waitTimeSeconds });
                    this.startCountdown(roomId, current, config);
                } else {
                    console.log(`[TIMER] Not enough players, starting poll`);
                    this.startPlayerPoll(roomId, current, config);
                }
            } catch (e) {
                console.error(`[TIMER] Error:`, e);
            }
        }, config.waitTimeSeconds * 1000, 'game_countdown');
    }

    startPlayerPoll(roomId, game, config) {
        const pc = this.getPlayerCount(game);
        console.log(`[POLL] Starting poll. Players: ${pc}, Need: ${config.minPlayersToStart}`);
        
        this.io.to(roomId).emit('waitingForPlayers', { needPlayers: config.minPlayersToStart - pc });
        
        timerManager.createInterval(`poll_${roomId}`, async () => {
            try {
                const updated = await Game.findById(game._id);
                if (!updated || updated.status === 'completed') {
                    timerManager.clearInterval(`poll_${roomId}`);
                    return;
                }
                
                const currentPlayers = updated.players ? updated.players.length : 0;
                console.log(`[POLL] Check: ${currentPlayers}/${config.minPlayersToStart} players`);
                
                if (currentPlayers >= config.minPlayersToStart) {
                    console.log(`[POLL] *** ENOUGH! STARTING GAME! ***`);
                    timerManager.clearInterval(`poll_${roomId}`);
                    await this.startGame(roomId, updated, config);
                } else if (currentPlayers === 0 && config.resetOnNoPlayers) {
                    console.log(`[POLL] All left, resetting`);
                    timerManager.clearInterval(`poll_${roomId}`);
                    updated.timerStartedAt = new Date();
                    await updated.save();
                    this.io.to(roomId).emit('countdownReset', { timerStartedAt: updated.timerStartedAt });
                    this.startCountdown(roomId, updated, config);
                }
            } catch (e) {
                console.error(`[POLL] Error:`, e);
            }
        }, 3000, 'player_poll');
    }

    async startGame(roomId, game, config) {
        console.log(`*** GAME #${game.gameNumber} STARTING! ***`);
        timerManager.clearInterval(`poll_${roomId}`);
        game.status = 'in_progress';
        game.startTime = new Date();
        await game.save();
        this.io.to(roomId).emit('gameStarted', { gameId: game.gameId, gameNumber: game.gameNumber, prizePool: game.prizePool, playerCount: this.getPlayerCount(game), totalCards: game.totalCards });
        this.drawNumbers(roomId, game, config);
    }
drawNumbers(roomId, game, config) {
    let idx = 0;
    timerManager.clearInterval(`draw_${roomId}`);
    timerManager.createInterval(`draw_${roomId}`, async () => {
        const current = await Game.findById(game._id);
        if (!current || current.status === 'completed' || current.status === 'grace_period') { 
            timerManager.clearInterval(`draw_${roomId}`); 
            return; 
        }
        
        // CHECK 1: All numbers drawn
        if (idx >= current.allNumbers.length) {
            timerManager.clearInterval(`draw_${roomId}`);
            await this.endGame(roomId, current);
            return;
        }
        
        // CHECK 2: All cards blocked - ADD THIS
        const activeCards = await Card.countDocuments({
            gameId: current._id,
            status: 'registered',
            isBlocked: false,
            bingoCalled: false
        });
        
        // CHECK 2: All cards blocked
if (activeCards === 0 && current.totalCards > 0) {
    console.log(`[DRAW] All cards blocked! Ending game #${current.gameNumber}`);
    timerManager.clearInterval(`draw_${roomId}`);
    
    // REFUND ALL PLAYERS
    const cards = await Card.find({ gameId: current._id, status: 'registered' });
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
        gameId: current._id, 
        winners: [], 
        prizePool: current.prizePool,
        reason: 'All cards blocked - refunded',
        refunded: true
    });
    
    // Create new game
    setTimeout(async () => {
        const conf = await GameConfig.findOne({ roomId });
        if (conf) {
            const ln = await Game.getLatestGameNumber(roomId);
            const ng = await Game.create({
                gameId: String(ln + 1).padStart(10, '0'),
                gameNumber: ln + 1, roomId,
                status: 'scheduled',
                allNumbers: this.shuffleNumbers(),
                timerDuration: conf.waitTimeSeconds
            });
            this.games.set(roomId, ng);
            this.io.to(roomId).emit('newGameCreated', { gameId: ng.gameId, gameNumber: ng.gameNumber });
        }
    }, 5000);
    return;
}
        
        // Normal draw
        const num = current.allNumbers[idx], letter = this.getBingoLetter(num);
        current.currentNumber = { number: num, letter };
        current.drawnNumbers.push({ number: num, letter });
        await current.save();
        this.io.to(roomId).emit('numberDrawn', { number: num, letter, drawCount: idx + 1, totalNumbers: current.allNumbers.length });
        idx++;
    }, config.drawIntervalSeconds * 1000, 'number_draw');
}
checkWin(card, drawnNumbers, config) {
    const drawnSet = new Set(drawnNumbers.map(d => d.number));
    const cols = ['B', 'I', 'N', 'G', 'O'];
    
    // 🔥 If isLastNumberCalledBingo is ON, check last number is on card
    if (config?.isLastNumberCalledBingo && drawnNumbers.length > 0) {
        const lastCalled = drawnNumbers[drawnNumbers.length - 1];
        const lastCell = card.grid[lastCalled.letter]?.find(c => c.number === lastCalled.number);
        
        if (!lastCell) {
            // Last called number NOT on this card - no BINGO possible
            return null;
        }
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

 async callBingo(roomId, userId, cardId) {
    const game = await Game.getActiveGame(roomId);
    if (!game || (game.status !== 'in_progress' && game.status !== 'bingo_called')) {
        throw new Error('Game not in progress');
    }
    
    const card = await Card.findOne({ _id: cardId, userId, gameId: game._id, status: 'registered' });
    if (!card || card.isBlocked) throw new Error('Card not valid');
    if (card.bingoCalled) throw new Error('Bingo already called');
    
    // 🔥 CHECK LAST NUMBER FIRST - before any pattern check
    const config = await GameConfig.findOne({ roomId });
    const lastCalled = game.drawnNumbers?.[game.drawnNumbers.length - 1];
    
    if (config?.isLastNumberCalledBingo && lastCalled) {
        const lastCell = card.grid[lastCalled.letter]?.find(c => c.number === lastCalled.number);
        
        if (!lastCell) {
            card.isBlocked = true;
            card.blockReason = 'Last number ' + lastCalled.letter + lastCalled.number + ' not on card';
            await card.save();
            
            this.io.to(roomId).emit('falseBingo', {
                userId,
                cardId,
                cardNumber: card.cardNumber,
                reason: 'Last number ' + lastCalled.letter + lastCalled.number + ' not on card'
            });
            
            return { success: false, falseBingo: true, reason: 'last_number_not_on_card' };
        }
    }
    
    const drawnSet = new Set(game.drawnNumbers.map(d => d.number));
    
    // STEP 1: Check if there's a winning pattern
    const winType = this.checkWin(card, game.drawnNumbers);
    
    // FALSE BINGO: No winning pattern
    if (!winType) {
        card.isBlocked = true;
        card.blockReason = 'no_win';
        await card.save();
        this.io.to(roomId).emit('falseBingo', { userId, cardId, cardNumber: card.cardNumber, reason: 'no_win' });
        return { success: false, falseBingo: true, reason: 'no_win' };
    }
    
    // STEP 2: Check ONLY the winning line for false marks
    const cols = ['B', 'I', 'N', 'G', 'O'];
    let hasInvalidMark = false;
    
    if (winType === 'line') {
        for (let r = 0; r < 5; r++) {
            let rowWin = true;
            for (let c of cols) {
                if (!(c === 'N' && r === 2) && !drawnSet.has(card.grid[c][r].number)) {
                    rowWin = false; break;
                }
            }
            if (rowWin) {
                for (let c of cols) {
                    if (c === 'N' && r === 2) continue;
                    const cell = card.grid[c][r];
                    if (cell.isMarked && !drawnSet.has(cell.number)) {
                        hasInvalidMark = true; break;
                    }
                }
                break;
            }
        }
        
        if (!hasInvalidMark) {
            for (let c of cols) {
                let colWin = true;
                for (let r = 0; r < 5; r++) {
                    if (!(c === 'N' && r === 2) && !drawnSet.has(card.grid[c][r].number)) {
                        colWin = false; break;
                    }
                }
                if (colWin) {
                    for (let r = 0; r < 5; r++) {
                        if (c === 'N' && r === 2) continue;
                        const cell = card.grid[c][r];
                        if (cell.isMarked && !drawnSet.has(cell.number)) {
                            hasInvalidMark = true; break;
                        }
                    }
                    break;
                }
            }
        }
    }
    
    // FALSE BINGO: Winning line has false marks
    if (hasInvalidMark) {
        card.isBlocked = true;
        card.blockReason = 'marked_uncalled';
        await card.save();
        this.io.to(roomId).emit('falseBingo', { userId, cardId, cardNumber: card.cardNumber, reason: 'marked_uncalled' });
        return { success: false, falseBingo: true, reason: 'marked_uncalled' };
    }
    
    // VALID BINGO! Auto-mark unmarked winning numbers
    for (let c of cols) {
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
        timerManager.clearInterval(`draw_${roomId}`);
        game.status = 'bingo_called';
        game.gracePeriodEndTime = new Date(Date.now() + 10000);
        await game.save();
        this.io.to(roomId).emit('firstBingo', { userId, cardId, cardNumber: card.cardNumber, winType });
        timerManager.createTimeout(`grace_${roomId}`, () => this.endGracePeriod(roomId, game._id), 10000, 'grace_period');
    } else {
        await game.save();
        this.io.to(roomId).emit('additionalBingo', { userId, cardId, cardNumber: card.cardNumber, winType });
    }
    
    return { success: true, winType };
}
    async endGracePeriod(roomId, gameId) {
        const game = await Game.findById(gameId); if (!game || game.status === 'completed') return;
        const config = await GameConfig.findOne({ roomId: game.roomId });
        const calledCards = await Card.find({ gameId: game._id, bingoCalled: true, isBlocked: false }).populate('userId');
        const winners = [];
        for (const card of calledCards) { const wt = this.checkWin(card, game.drawnNumbers); if (wt) { card.bingoValidated = true; await card.save(); winners.push({ card, winType: wt }); } }
        if (winners.length > 0) { const comm = (game.prizePool * (config?.commissionPercentage || 10)) / 100; const ppw = (game.prizePool - comm) / winners.length;
            for (const { card, winType } of winners) { const user = card.userId; await User.findByIdAndUpdate(user._id, { $inc: { walletBalance: ppw } }); await Transaction.create({ userId: user._id, type: 'prize_win', amount: ppw, gameId: game.gameId, gameNumber: game.gameNumber, description: `Won with ${winType}`, balanceAfter: (user.walletBalance || 0) + ppw });
             game.winners.push({
    userId: user._id,
    cardId: card._id,
    winType,
    prizeAmount: ppw,
    winnerName: user.fullName,
    winnerPhone: user.phone,
    cardNumber: card.cardNumber,      // ← ADD
    cardGrid: card.grid               // ← ADD (the actual marked grid!)
});
             await this.sendWinningNotification(user._id, ppw, game.gameNumber, winType); }
            await Transaction.create({ type: 'commission', amount: comm, gameId: game.gameId, gameNumber: game.gameNumber, description: 'Commission' }); game.commission = comm; }
        game.status = 'completed'; game.endTime = new Date(); await game.save();
        timerManager.clearInterval(`draw_${roomId}`); timerManager.clearTimeout(`grace_${roomId}`);
        this.io.to(roomId).emit('gameEnded', { gameId: game._id, winners: game.winners, prizePool: game.prizePool, commission: game.commission });
        setTimeout(async () => { const conf = await GameConfig.findOne({ roomId: game.roomId }); if (conf) { const ln = await Game.getLatestGameNumber(roomId); const ng = await Game.create({ gameId: String(ln + 1).padStart(10, '0'), gameNumber: ln + 1, roomId, status: 'scheduled', allNumbers: this.shuffleNumbers(), timerDuration: conf.waitTimeSeconds }); this.games.set(roomId, ng); this.io.to(roomId).emit('newGameCreated', { gameId: ng.gameId, gameNumber: ng.gameNumber }); } }, 5000);
    }

   async endGame(roomId, game) {
    game.status = 'completed';
    game.endTime = new Date();
    game.endReason = game.endReason || 'all_numbers_drawn';
    await game.save();
    
    timerManager.clearInterval(`draw_${roomId}`);
    
    // REFUND ALL PLAYERS
    const cards = await Card.find({ gameId: game._id, status: 'registered' });
    let totalRefunded = 0;
    
    for (const card of cards) {
        const user = await User.findById(card.userId);
        if (user) {
            user.walletBalance += card.price;
            await user.save();
            totalRefunded += card.price;
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
    
    console.log(`💰 Refunded ${totalRefunded} ETB to ${cards.length} cards`);
    
    this.io.to(roomId).emit('gameEnded', { 
        gameId: game._id, 
        winners: [], 
        prizePool: game.prizePool,
        reason: 'No winner - all refunded',
        refunded: true,
        totalRefunded
    });
    
    // Create new game
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
        }
    }, 5000);
}
    async getGameState(roomId, userId) {
        const game = await Game.getActiveGame(roomId); if (!game) return null;
        const config = await GameConfig.findOne({ roomId });
        const myCards = userId ? await Card.find({ gameId: game._id, userId, status: 'registered' }) : [];
        const previewCards = userId ? await Card.find({ gameId: game._id, userId, status: 'preview' }) : [];
        const user = userId ? await User.findById(userId).select('walletBalance') : null;
        return { gameId: game.gameId, gameNumber: game.gameNumber, status: game.status, playerCount: this.getPlayerCount(game), totalCards: game.totalCards, prizePool: game.prizePool, currentNumber: game.currentNumber, drawnNumbers: game.drawnNumbers, drawCount: game.drawnNumbers?.length || 0, timeRemaining: this.getTimeRemaining(game), timerDuration: game.timerDuration, timerStartedAt: game.timerStartedAt, config: { cardPrice: config?.cardPrice, maxCardsPerPlayer: config?.maxCardsPerPlayer, minPlayersToStart: config?.minPlayersToStart, commissionPercentage: config?.commissionPercentage, waitTimeSeconds: config?.waitTimeSeconds, drawIntervalSeconds: config?.drawIntervalSeconds }, myCards, myCardsCount: myCards.length, previewCards, previewCardsCount: previewCards.length, winners: game.winners, balance: user?.walletBalance || 0 };
    }

    getTimeRemaining(game) { if (!game.timerStartedAt) return game.timerDuration; const elapsed = (Date.now() - game.timerStartedAt.getTime()) / 1000; return Math.max(0, game.timerDuration - elapsed); }
}

module.exports = GameEngine;