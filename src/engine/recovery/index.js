const Game = require('../../models/Game');
const GameConfig = require('../../models/GameConfig');
const timerManager = require('../../utils/TimerManager');

class RecoveryService {
  constructor(engine) { this.engine = engine; }

  async recoverFromCrash() {
    const stuckGames = await Game.find({
      status: { $in: ['in_progress', 'bingo_called', 'waiting', 'scheduled'] },
      updatedAt: { $lt: new Date(Date.now() - 30000) }
    });
    
    for (const game of stuckGames) {
      await this.decide(game);
    }
  }

  async decide(game) {
    if (await this.shouldRefund(game)) {
      await this.refundAndRestart(game);
    } else {
      await this.recover(game);
    }
  }

  async shouldRefund(game) {
    const config = await GameConfig.findOne({ roomId: game.roomId });
    
    if (game.status === 'waiting' || game.status === 'scheduled') {
      if (config && game.timerStartedAt) {
        const elapsed = (Date.now() - game.timerStartedAt.getTime()) / 1000;
        if (elapsed > Math.max(config.waitTimeSeconds * 3, 120)) return true;
      }
      return false;
    }
    
    const inactiveTime = (Date.now() - game.updatedAt) / 1000;
    if (inactiveTime > 600) return true;
    if (game.drawnNumbers && game.drawnNumbers.length < 5) return true;
    return false;
  }

  async refundAndRestart(game) {
    await this.engine.refunds.refundGame(game._id, 'server_interruption');
    this.engine.io.to(game.roomId).emit('gameCancelled', { gameNumber: game.gameNumber });
    await this.createNewGame(game.roomId, 3000);
  }

  async recover(game) {
    const config = await GameConfig.findOne({ roomId: game.roomId });
    if (!config) { await this.refundAndRestart(game); return; }
    
    this.engine.games.set(game.roomId, game);
    
    switch (game.status) {
      case 'scheduled':
      case 'waiting':
        await this.recoverWaiting(game, config);
        break;
      case 'in_progress':
        await this.recoverRunning(game, config);
        break;
      case 'bingo_called':
        await this.recoverGrace(game, config);
        break;
    }
  }

  async recoverWaiting(game, config) {
    const pc = this.engine.getPlayerCount(game);
    const elapsed = game.timerStartedAt ? (Date.now() - game.timerStartedAt.getTime()) / 1000 : 0;
    const tr = Math.max(0, config.waitTimeSeconds - elapsed);
    
    if (tr <= 0 && pc >= config.minPlayersToStart) {
      await this.engine.gameFlow.startGame(game.roomId, game, config);
    } else if (tr <= 0) {
      this.engine.gameFlow.startPlayerPoll(game.roomId, game, config);
    } else {
      this.engine.gameFlow.startCountdown(game.roomId, game, config);
    }
  }

  async recoverRunning(game, config) {
    let idx = game.drawnNumbers.length;
    timerManager.createInterval(`draw_${game.roomId}`, async () => {
      const current = await Game.findById(game._id);
      if (!current || current.status === 'completed' || current.status === 'grace_period') {
        timerManager.clearInterval(`draw_${game.roomId}`); return;
      }
      if (idx >= current.allNumbers.length) {
        timerManager.clearInterval(`draw_${game.roomId}`);
        await this.engine.gameFlow.endGame(game.roomId, current);
        return;
      }
      const num = current.allNumbers[idx], letter = this.engine.getBingoLetter(num);
      current.currentNumber = { number: num, letter };
      current.drawnNumbers.push({ number: num, letter });
      await current.save();
     
      idx++;
    }, config.drawIntervalSeconds * 1000, 'number_draw');
  }

  async recoverGrace(game, config) {
    const ge = game.gracePeriodEndTime ? (Date.now() - game.gracePeriodEndTime.getTime()) / 1000 : 999;
    if (ge >= 0) {
      await this.engine.gameFlow.endGracePeriod(game.roomId, game._id);
    } else {
      timerManager.createTimeout(`grace_${game.roomId}`,
        () => this.engine.gameFlow.endGracePeriod(game.roomId, game._id),
        Math.abs(ge) * 1000, 'grace_period');
    }
  }

  async createNewGame(roomId, delay) {
    return new Promise(resolve => setTimeout(async () => {
      const config = await GameConfig.findOne({ roomId, isActive: true });
      if (!config) { resolve(false); return; }
      const lastNum = await Game.getLatestGameNumber(roomId);
      const newGame = await Game.create({
        gameId: String(lastNum + 1).padStart(10, '0'),
        gameNumber: lastNum + 1, roomId, status: 'scheduled',
        allNumbers: this.engine.shuffleNumbers(),
        timerDuration: config.waitTimeSeconds
      });
      this.engine.games.set(roomId, newGame);
      this.engine.io.to(roomId).emit('newGameCreated', { gameId: newGame.gameId, gameNumber: newGame.gameNumber });
      resolve(true);
    }, delay));
  }
}

module.exports = RecoveryService;