const Card = require("../../models/Card");
const Game = require("../../models/Game");
const GameConfig = require("../../models/GameConfig");
const User = require("../../models/User");
const Transaction = require("../../models/Transaction");
const mongoose = require("mongoose");

class CardService {
  constructor(engine) {
    this.engine = engine;
    this.purchaseLocks = new Map();
  }

async registerCard(roomId, userId, cardId, socketCallback) {
    const lockKey = `${roomId}_${cardId}`;

    console.log("🟢 [REGISTER] Starting:", { roomId, userId, cardId });

    if (this.purchaseLocks.has(lockKey)) {
        const err = "Card is being purchased by another player";
        if (typeof socketCallback === "function")
            socketCallback({ status: "error", message: err });
        throw new Error(err);
    }

    this.purchaseLocks.set(lockKey, { userId, timestamp: Date.now() });

    try {
        // Step 1: Validate game
        const game = await Game.getActiveGame(roomId);
        console.log("🟢 [REGISTER] Game:", game ? `Status: ${game.status}` : "NULL");

        if (!game || !["scheduled", "waiting"].includes(game.status)) {
            throw new Error("Game not available for purchase");
        }

        const config = await GameConfig.findOne({ roomId });
        if (!config) throw new Error("Game configuration not found");
        
        // 🔧 FIX: Get price from config
        const cardPrice = config.cardPrice;
        console.log('💰 [REGISTER] Card price from config:', cardPrice);

        // Step 2: Atomic card claim
        const card = await Card.findOneAndUpdate(
            {
                _id: cardId,
                status: 'available',
                $or: [
                    { gameId: game._id },
                    { gameId: null }
                ]
            },
            {
                $set: {
                    status: 'reserved',
                    reservedAt: new Date(),
                    reservedBy: userId,
                    gameId: game._id
                }
            },
            { new: true }
        );

        if (!card) {
            const cardExists = await Card.findById(cardId);
            console.log("❌ [REGISTER] Card not found. Exists:", !!cardExists,
                "Status:", cardExists?.status,
                "UserId:", cardExists?.userId?.toString());
            throw new Error("Card is no longer available");
        }

        // Step 3: Check limit
        const registeredCount = await Card.countDocuments({
            gameId: game._id,
            userId,
            status: "registered",
        });

        if (registeredCount >= config.maxCardsPerPlayer) {
            await Card.findByIdAndUpdate(cardId, {
                $set: { status: "preview", reservedBy: null, reservedAt: null },
            });
            throw new Error(`Maximum ${config.maxCardsPerPlayer} cards allowed`);
        }

        // 🔧 FIXED Step 4: Deduct balance using config.cardPrice
        const user = await User.findOneAndUpdate(
            { 
                _id: userId, 
                walletBalance: { $gte: cardPrice }  // 🔧 Use config price
            },
            { 
                $inc: { walletBalance: -cardPrice }  // 🔧 Use config price
            },
            { new: true },
        );

        if (!user) {
            await Card.findByIdAndUpdate(cardId, {
                $set: { status: "preview", reservedBy: null, reservedAt: null },
            });
            throw new Error(`Insufficient balance. Need ${cardPrice} ETB`);
        }

        console.log("🟢 [REGISTER] Balance deducted:", user.walletBalance);

        // Step 5: Update game
        const updatedGame = await Game.findOneAndUpdate(
            { _id: game._id, status: { $in: ["scheduled", "waiting"] } },
            {
                $inc: { 
                    totalCards: 1, 
                    prizePool: cardPrice  // 🔧 Use config price here too
                },
                $set: {
                    timerStartedAt: game.players.length === 0 ? new Date() : game.timerStartedAt,
                    status: game.players.length === 0 ? "waiting" : game.status,
                },
            },
            { new: true },
        );

        if (!updatedGame) {
            await User.findByIdAndUpdate(userId, {
                $inc: { walletBalance: cardPrice },  // 🔧 Refund config price
            });
            await Card.findByIdAndUpdate(cardId, {
                $set: { status: "preview", reservedBy: null, reservedAt: null },
            });
            throw new Error("Game state changed. Please try again.");
        }

        // Step 6: Finalize card
        card.userId = userId;
        card.gameId = updatedGame._id;
        card.status = "registered";
        card.cardNumber = updatedGame.totalCards;
        card.price = cardPrice;  // 🔧 Save price on card for reference
        card.registeredAt = new Date();
        card.reservedBy = null;
        card.reservedAt = null;
        await card.save();

        // Step 7: Update players
        const playerIndex = updatedGame.players.findIndex(
            (p) => p.userId.toString() === userId,
        );

        if (playerIndex === -1) {
            updatedGame.players.push({ userId, cards: [card._id] });
        } else {
            updatedGame.players[playerIndex].cards.push(card._id);
        }
        await updatedGame.save();

        // Step 8: Create transaction
        await Transaction.create({
            userId,
            type: "card_purchase",
            amount: -cardPrice,  // 🔧 Use config price
            gameId: updatedGame.gameId,
            gameNumber: updatedGame.gameNumber,
            description: `Card #${card.cardNumber}`,
            balanceAfter: user.walletBalance,
            cardId: card._id,
            status: "completed",
        });

        // Step 9: Start countdown
        if (updatedGame.players.length === 1) {
            this.engine.gameFlow.startCountdown(roomId, updatedGame, config);
        }

        // Send callback
        console.log("🟢 [REGISTER] Sending callback...");
        if (typeof socketCallback === "function") {
            socketCallback({
                status: "ok",
                cardId: card._id,
                cardNumber: card.cardNumber,
                newBalance: user.walletBalance,
            });
        }

        // Notify via socket
        const buyerSocket = this.engine.getUserSocket(userId);
        if (buyerSocket) {
            buyerSocket.emit("balanceUpdated", {
                newBalance: user.walletBalance,
                cardNumber: card.cardNumber,
            });
        }

        // Broadcast to room
        this.engine.io.to(roomId).emit("cardRegistered", {
            userId,
            cardId: card._id,
            cardNumber: card.cardNumber,
            displayId: card.displayId,
            totalCards: updatedGame.totalCards,
            playerCount: updatedGame.players.length,
            prizePool: updatedGame.prizePool,
            timerStartedAt: updatedGame.timerStartedAt,
            timerDuration: updatedGame.timerDuration,
        });

        console.log("✅ [REGISTER] Success! Card:", card.cardNumber);

        return {
            success: true,
            cardNumber: card.cardNumber,
            cardId: card._id,
            newBalance: user.walletBalance,
            cardsOwned: registeredCount + 1,
        };
    } catch (error) {
        console.log("❌ [REGISTER] Error:", error.message);

        if (typeof socketCallback === "function") {
            socketCallback({
                status: "error",
                message: error.message,
            });
        }

        throw error;
    } finally {
        setTimeout(() => {
            this.purchaseLocks.delete(lockKey);
        }, 1000);
    }
}

  // ... rest of the methods stay the same ...
  async previewCards(roomId, userId, quantity = 1) {
    const game = await Game.getActiveGame(roomId);
    if (!game || !["scheduled", "waiting"].includes(game.status)) {
      throw new Error("Game not available");
    }

    const config = await GameConfig.findOne({ roomId });
    const registeredCount = await Card.countDocuments({
      gameId: game._id,
      userId,
      status: "registered",
    });
    const previewCount = await Card.countDocuments({
      gameId: game._id,
      userId,
      status: "preview",
    });

    const available = config.maxCardsPerPlayer - registeredCount - previewCount;
    const actualQty = Math.min(quantity, available);

    if (actualQty <= 0)
      throw new Error(`Maximum ${config.maxCardsPerPlayer} cards allowed`);

    const cards = [];
    for (let i = 0; i < actualQty; i++) {
      cards.push({
        gameId: game._id,
        userId,
        cardNumber: game.totalCards + i + 1,
        grid: this.engine.generateGrid(),
        price: config.cardPrice,
        status: "preview",
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      });
    }

    const created = await Card.insertMany(cards);

    const sock = this.engine.getUserSocket(userId);
    if (sock) {
      created.forEach((card) => {
        sock.emit("previewCardGenerated", { userId, card });
      });
    }

    return { success: true, count: created.length, cards: created };
  }

  async cancelPreviewCard(roomId, userId, cardId) {
    await Card.deleteOne({ _id: cardId, userId, status: "preview" });
    const sock = this.engine.getUserSocket(userId);
    if (sock) sock.emit("previewCardCancelled", { userId, cardId });
    return { success: true };
  }

  async cleanupExpiredPreviews() {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const expired = await Card.find({
      status: "preview",
      createdAt: { $lt: fiveMinutesAgo },
    });

    for (const card of expired) {
      const sock = this.engine.getUserSocket(card.userId);
      if (sock) sock.emit("previewCardExpired", { cardId: card._id });
    }

    await Card.deleteMany({
      status: "preview",
      createdAt: { $lt: fiveMinutesAgo },
    });
    return { cleaned: expired.length };
  }
}

module.exports = CardService;
