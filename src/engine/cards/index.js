const Card = require('../../models/Card');
const Game = require('../../models/Game');
const GameConfig = require('../../models/GameConfig');
const User = require('../../models/User');
const Transaction = require('../../models/Transaction');

class CardService {
  constructor(engine) { this.engine = engine; }

  async buyCard(roomId, userId) {
    const game = await Game.getActiveGame(roomId);
    if (!game || (game.status !== 'scheduled' && game.status !== 'waiting')) {
      throw new Error('Game not available');
    }
    
    const config = await GameConfig.findOne({ roomId });
    if (!config) throw new Error('Config not found');
    
    const player = game.players.find(p => p.userId.toString() === userId);
    const cc = player?.cards?.length || 0;
    if (cc >= config.maxCardsPerPlayer) throw new Error(`Max ${config.maxCardsPerPlayer} cards`);
    
    const user = await User.findById(userId);
    if (user.walletBalance < config.cardPrice) throw new Error(`Need ${config.cardPrice} coins`);
    
    user.walletBalance -= config.cardPrice; await user.save();
    
    const card = await Card.create({
      gameId: game._id, userId, cardNumber: game.totalCards + 1,
      grid: this.engine.generateGrid(), price: config.cardPrice, status: 'registered'
    });
    
    if (!player) game.players.push({ userId, cards: [card._id] });
    else player.cards.push(card._id);
    
    game.totalCards += 1; game.prizePool += config.cardPrice;
    
    await Transaction.create({
      userId, type: 'card_purchase', amount: -config.cardPrice,
      gameId: game.gameId, gameNumber: game.gameNumber,
      description: `Card #${card.cardNumber}`, balanceAfter: user.walletBalance
    });
    
    if (game.players.length === 1 && !game.timerStartedAt) {
      game.timerStartedAt = new Date(); game.status = 'waiting';
      this.engine.gameFlow.startCountdown(roomId, game, config);
    }
    
    await game.save();
    
    this.engine.io.to(roomId).emit('cardPurchased', {
      cardId: card._id, displayId: card.displayId,
      totalCards: game.totalCards, playerCount: game.players.length,
      prizePool: game.prizePool, timerStartedAt: game.timerStartedAt,
      timerDuration: game.timerDuration
    });
    
    return { success: true, card, newBalance: user.walletBalance, cardsOwned: cc + 1 };
  }

  async previewCard(roomId, userId) {
    const game = await Game.getActiveGame(roomId);
    if (!game || (game.status !== 'scheduled' && game.status !== 'waiting')) {
      throw new Error('Game not available');
    }
    
    const config = await GameConfig.findOne({ roomId });
    const rc = await Card.countDocuments({ gameId: game._id, userId, status: 'registered' });
    if (rc >= config.maxCardsPerPlayer) throw new Error(`Max ${config.maxCardsPerPlayer} cards`);
    
    const card = await Card.create({
      gameId: game._id, userId, cardNumber: game.totalCards + 1,
      grid: this.engine.generateGrid(), price: config.cardPrice, status: 'preview'
    });
    
    const sock = this.engine.getUserSocket(userId);
    if (sock) sock.emit('previewCardGenerated', { userId, card });
    
    return { success: true, card };
  }

  async previewCards(roomId, userId, quantity) {
    const game = await Game.getActiveGame(roomId);
    if (!game || (game.status !== 'scheduled' && game.status !== 'waiting')) {
      throw new Error('Game not available');
    }
    
    const config = await GameConfig.findOne({ roomId });
    const registeredCount = await Card.countDocuments({ gameId: game._id, userId, status: 'registered' });
    const previewCount = await Card.countDocuments({ gameId: game._id, userId, status: 'preview' });
    
    const available = config.maxCardsPerPlayer - registeredCount - previewCount;
    const actualQty = Math.min(quantity, available);
    if (actualQty <= 0) throw new Error(`Max ${config.maxCardsPerPlayer} cards`);
    
    const cards = [];
    for (let i = 0; i < actualQty; i++) {
      cards.push({
        gameId: game._id, userId,
        cardId: new (require('mongoose').Types.ObjectId)(),
        cardNumber: game.totalCards + i + 1,
        grid: this.engine.generateGrid(), price: config.cardPrice, status: 'preview'
      });
    }
    
    const created = await Card.insertMany(cards);
    const sock = this.engine.getUserSocket(userId);
    if (sock) created.forEach(card => sock.emit('previewCardGenerated', { userId, card }));
    
    return { success: true, count: created.length };
  }

  async registerCard(roomId, userId, cardId) {
    const game = await Game.getActiveGame(roomId);
    if (!game || (game.status !== 'scheduled' && game.status !== 'waiting')) {
      throw new Error('Game not available');
    }
    
    const config = await GameConfig.findOne({ roomId });
    if (!config) throw new Error('Config not found');
    
    const card = await Card.findOne({
      _id: cardId,
      $or: [
        { gameId: game._id, userId, status: 'preview' },
        { _id: cardId, userId: null, status: { $in: ['available', 'preview'] } }
      ]
    });
    if (!card) throw new Error('Card not found');
    
    const registeredCount = await Card.countDocuments({ gameId: game._id, userId, status: 'registered' });
    if (registeredCount >= config.maxCardsPerPlayer) throw new Error(`Max ${config.maxCardsPerPlayer} cards`);
    
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');
    if (user.walletBalance < card.price) throw new Error(`Need ${card.price} ETB`);
    
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
    
    if (!ug) throw new Error('Game update failed');
    
    card.userId = userId; card.gameId = ug._id; card.status = 'registered';
    card.cardNumber = ug.totalCards; card.registeredAt = new Date();
    await card.save();
    
    const pi = ug.players.findIndex(p => p.userId.toString() === userId);
    if (pi === -1) ug.players.push({ userId, cards: [card._id] });
    else ug.players[pi].cards.push(card._id);
    await ug.save();
    
    user.walletBalance -= card.price; await user.save();
    
    await Transaction.create({
      userId, type: 'card_purchase', amount: -card.price,
      gameId: ug.gameId, gameNumber: ug.gameNumber,
      description: `Card #${card.cardNumber}`, balanceAfter: user.walletBalance, cardId: card._id
    });
    
    if (!ug.timerStartedAt) { ug.timerStartedAt = new Date(); await ug.save(); }
    if (ug.players.length === 1) this.engine.gameFlow.startCountdown(roomId, ug, config);
    
    this.engine.io.to(roomId).emit('cardRegistered', {
      userId, cardId: card._id, cardNumber: card.cardNumber,
      totalCards: ug.totalCards, playerCount: ug.players.length,
      prizePool: ug.prizePool, timerStartedAt: ug.timerStartedAt, timerDuration: ug.timerDuration
    });
    
    const sock = this.engine.getUserSocket(userId);
    if (sock) sock.emit('balanceUpdated', { newBalance: user.walletBalance, cardNumber: card.cardNumber });
    
    return { success: true, cardNumber: card.cardNumber, newBalance: user.walletBalance };
  }

  async cancelPreviewCard(roomId, userId, cardId) {
    await Card.deleteOne({ _id: cardId, userId, status: 'preview' });
    const sock = this.engine.getUserSocket(userId);
    if (sock) sock.emit('previewCardCancelled', { userId, cardId });
    return { success: true };
  }
}

module.exports = CardService;