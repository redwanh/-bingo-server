// server/src/services/CacheService.js
// Empty cache - Redis removed temporarily
class CacheService {
  async addDrawnNumber() {}
  async isNumberDrawn() { return false; }
  async getDrawnNumbers() { return []; }
  async setGameState() {}
  async getGameState() { return null; }
  async clearGame() {}
}
module.exports = new CacheService();