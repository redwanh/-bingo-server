const redis = require('../config/redis');
const logger = require('../config/logger');
const { REDIS_KEYS } = require('../config/constants');

class CacheService {
  
  async addDrawnNumber(gameId, number) {
    try {
      await redis.sadd(REDIS_KEYS.DRAWN_NUMBERS(gameId), number);
    } catch (e) {
      // Redis failed - silently continue
    }
  }

  async isNumberDrawn(gameId, number) {
    try {
      return await redis.sismember(REDIS_KEYS.DRAWN_NUMBERS(gameId), number);
    } catch (e) {
      return false;
    }
  }

  async getDrawnNumbers(gameId) {
    try {
      return (await redis.smembers(REDIS_KEYS.DRAWN_NUMBERS(gameId))).map(Number);
    } catch (e) {
      return [];
    }
  }

  async setGameState(gameId, state) {
    try {
      await redis.set(REDIS_KEYS.GAME_STATE(gameId), JSON.stringify(state), 'EX', 3600);
    } catch (e) {}
  }

  async getGameState(gameId) {
    try {
      const data = await redis.get(REDIS_KEYS.GAME_STATE(gameId));
      return data ? JSON.parse(data) : null;
    } catch (e) {
      return null;
    }
  }

  async clearGame(gameId) {
    try {
      await redis.del(REDIS_KEYS.GAME_STATE(gameId));
      await redis.del(REDIS_KEYS.DRAWN_NUMBERS(gameId));
    } catch (e) {}
  }
}

module.exports = new CacheService();