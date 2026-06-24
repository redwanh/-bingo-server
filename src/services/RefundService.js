const User = require('../models/User');
const Card = require('../models/Card');
const Game = require('../models/Game');
const Transaction = require('../models/Transaction');
const notificationService = require('./NotificationService');

class RefundService {
    /**
     * 🏥 Refund all players for a crashed game
     */
    async refundGame(gameId, reason = 'server_crash') {
        console.log(`💰 Starting refund process for game ${gameId}`);
        
        try {
            const game = await Game.findById(gameId);
            if (!game) {
                throw new Error('Game not found');
            }

            // Get all registered cards for this game
            const cards = await Card.find({
                gameId: game._id,
                status: 'registered'
            }).populate('userId');

            console.log(`📊 Found ${cards.length} cards to refund`);

            // Track refund stats
            const refundStats = {
                totalCards: cards.length,
                totalAmount: 0,
                successfulRefunds: 0,
                failedRefunds: 0,
                refundedUsers: new Set()
            };

            // Process refunds
            for (const card of cards) {
                try {
                    await this.refundSingleCard(card, game, reason, refundStats);
                } catch (error) {
                    console.error(`❌ Failed to refund card ${card._id}:`, error);
                    refundStats.failedRefunds++;
                }
            }

            // Update game status
            game.status = 'completed';
            game.endTime = new Date();
            game.endReason = reason;
            game.refundStats = {
                totalRefunded: refundStats.totalAmount,
                cardsRefunded: refundStats.successfulRefunds,
                usersRefunded: refundStats.refundedUsers.size
            };
            await game.save();

            console.log(`✅ Refund complete:`, {
                totalAmount: refundStats.totalAmount,
                successfulRefunds: refundStats.successfulRefunds,
                failedRefunds: refundStats.failedRefunds,
                uniqueUsers: refundStats.refundedUsers.size
            });

            return refundStats;
        } catch (error) {
            console.error('❌ Refund process failed:', error);
            throw error;
        }
    }

    /**
     * 💰 Refund a single card
     */
    async refundSingleCard(card, game, reason, stats) {
        const user = card.userId;
        
        if (!user) {
            console.warn(`⚠️ No user found for card ${card._id}`);
            return;
        }

        // Calculate refund amount
        const refundAmount = card.price || 0;
        
        // Add money back to user's wallet
        const updatedUser = await User.findByIdAndUpdate(
            user._id,
            { $inc: { walletBalance: refundAmount } },
            { new: true }
        );

        if (!updatedUser) {
            throw new Error(`Failed to update user ${user._id}`);
        }

        // Create refund transaction record
        await Transaction.create({
            userId: user._id,
            type: 'refund',
            amount: refundAmount,
            gameId: game.gameId,
            gameNumber: game.gameNumber,
            description: `Refund for Game #${game.gameNumber} - ${reason}`,
            balanceAfter: updatedUser.walletBalance,
            cardId: card._id,
            metadata: {
                reason: reason,
                originalCardNumber: card.cardNumber,
                refundedAt: new Date()
            }
        });

        // Mark card as refunded
        card.status = 'refunded';
        card.refundedAt = new Date();
        card.refundReason = reason;
        await card.save();

        // Send notification to user
        await notificationService.sendRefundNotification(
            user._id,
            refundAmount,
            game.gameNumber,
            reason === 'server_crash' ? 'Server was restarted.' : 'Game was interrupted.'
        );

        // Send real-time notification via socket if connected
        this.sendRealTimeNotification(user._id, {
            type: 'refund',
            amount: refundAmount,
            gameNumber: game.gameNumber,
            newBalance: updatedUser.walletBalance
        });

        // Update stats
        stats.totalAmount += refundAmount;
        stats.successfulRefunds++;
        stats.refundedUsers.add(user._id.toString());

        console.log(`✅ Refunded ${refundAmount} ETB to user ${user._id} for card ${card._id}`);
    }

    /**
     * 📱 Send real-time socket notification
     */
    sendRealTimeNotification(userId, data) {
        // This will be set by GameEngine
        if (this.io) {
            const socket = this.getUserSocket(userId);
            if (socket) {
                socket.emit('refundProcessed', {
                    message: `Your ${data.amount} ETB has been refunded for Game #${data.gameNumber}`,
                    newBalance: data.newBalance,
                    amount: data.amount
                });
            }
        }
    }

    /**
     * 🔍 Check if a game needs refunding
     */
    async shouldRefundGame(game) {
        // Refund if game was interrupted and not completed naturally
        if (game.status === 'completed' && game.endReason === 'natural') {
            return false; // Game ended normally
        }

        // Refund if game didn't reach minimum numbers
        if (game.drawnNumbers && game.drawnNumbers.length < 10) {
            return true; // Not enough numbers drawn
        }

        // Refund if game was stuck
        const stuckTime = 5 * 60 * 1000; // 5 minutes
        if (game.updatedAt && (Date.now() - game.updatedAt) > stuckTime) {
            return true; // Game hasn't been updated in 5 minutes
        }

        return false;
    }
}

module.exports = new RefundService();