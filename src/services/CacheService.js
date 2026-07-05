const redis = require('../../config/redis');
const logger = require('../../config/logger');
const { REDIS_KEYS } = require('../../config/constants');

class CacheService {
  // ============================================
  // GAME STATE
  // ============================================
  async setGameState(gameId, state) {
    const key = REDIS_KEYS.GAME_STATE(gameId);
    await redis.set(key, JSON.stringify(state), 'EX', 3600); // 1 hour
    logger.debug(`Cache: Game state set for ${gameId}`);
  }

  async getGameState(gameId) {
    const key = REDIS_KEYS.GAME_STATE(gameId);
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  async deleteGameState(gameId) {
    await redis.del(REDIS_KEYS.GAME_STATE(gameId));
  }

  // ============================================
  // DRAWN NUMBERS (Set for O(1) lookup)
  // ============================================
  async addDrawnNumber(gameId, number) {
    await redis.sadd(REDIS_KEYS.DRAWN_NUMBERS(gameId), number);
  }

  async getDrawnNumbers(gameId) {
    return (await redis.smembers(REDIS_KEYS.DRAWN_NUMBERS(gameId))).map(Number);
  }

  async isNumberDrawn(gameId, number) {
    return await redis.sismember(REDIS_KEYS.DRAWN_NUMBERS(gameId), number);
  }

  async clearDrawnNumbers(gameId) {
    await redis.del(REDIS_KEYS.DRAWN_NUMBERS(gameId));
  }

  // ============================================
  // PLAYER CARDS
  // ============================================
  async addPlayerCard(gameId, userId, cardId) {
    await redis.sadd(REDIS_KEYS.PLAYER_CARDS(gameId, userId), cardId);
  }

  async getPlayerCards(gameId, userId) {
    return await redis.smembers(REDIS_KEYS.PLAYER_CARDS(gameId, userId));
  }

  async clearPlayerCards(gameId) {
    // Find all player card keys and delete them
    const pattern = REDIS_KEYS.PLAYER_CARDS(gameId, '*');
    const keys = await redis.keys(pattern);
    if (keys.length > 0) await redis.del(...keys);
  }

  // ============================================
  // CLEANUP
  // ============================================
  async clearGame(gameId) {
    await this.deleteGameState(gameId);
    await this.clearDrawnNumbers(gameId);
    await this.clearPlayerCards(gameId);
    logger.debug(`Cache: Cleared all data for game ${gameId}`);
  }
}

module.exports = new CacheService();