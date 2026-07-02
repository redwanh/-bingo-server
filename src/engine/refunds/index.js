const Transaction = require('../../models/Transaction');
const User = require('../../models/User');
const Card = require('../../models/Card');
const Game = require('../../models/Game');

class RefundService {
  constructor(engine) { this.engine = engine; }

  async refundGame(gameId, reason = 'server_interruption') {
    const game = await Game.findById(gameId);
    if (!game) throw new Error('Game not found');
    
    const cards = await Card.find({ gameId: game._id, status: 'registered' });
    const stats = { totalCards: cards.length, totalAmount: 0, successfulRefunds: 0, failedRefunds: 0, refundedUsers: new Set() };
    
    for (const card of cards) {
      try { await this.refundSingle(card, game, reason, stats); }
      catch (e) { stats.failedRefunds++; }
    }
    
    game.status = 'completed'; game.endTime = new Date(); game.endReason = reason;
    game.refundStats = { totalRefunded: stats.totalAmount, cardsRefunded: stats.successfulRefunds, usersRefunded: stats.refundedUsers.size };
    await game.save();
    
    return stats;
  }

  async refundSingle(card, game, reason, stats) {
    const user = await User.findById(card.userId);
    if (!user) return;
    
    const amt = card.price || 0;
    user.walletBalance += amt;
    await user.save();
    
    await Transaction.create({
      userId: user._id, type: 'refund', amount: amt,
      gameId: game.gameId, gameNumber: game.gameNumber,
      description: `Refund Game #${game.gameNumber}`,
      balanceAfter: user.walletBalance, cardId: card._id
    });
    
    card.status = 'available'; card.userId = null; card.gameId = null;
    card.isBlocked = false; card.bingoCalled = false;
    card.refundedAt = new Date(); card.refundReason = reason;
    await card.save();
    
    this.engine.notifications.sendRefund(user._id, amt, game.gameNumber, reason);
    
    stats.totalAmount += amt; stats.successfulRefunds++; stats.refundedUsers.add(user._id.toString());
  }
}

module.exports = RefundService;