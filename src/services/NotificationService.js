const Notification = require('../models/Notification');

class NotificationService {
    /**
     * Send notification to a single user
     */
    async sendToUser(userId, notificationData) {
        try {
            const notification = await Notification.create({
                user: userId,
                type: notificationData.type || 'system',
                title: notificationData.title || 'Game Update',
                titleAm: notificationData.titleAm || notificationData.title,  // Fallback to English
                titleTg: notificationData.titleTg || notificationData.title,  // Fallback to English
                message: notificationData.message,
                messageAm: notificationData.messageAm || notificationData.message,
                messageTg: notificationData.messageTg || notificationData.message,
                priority: notificationData.priority || 'normal',
                amount: notificationData.amount,
                expiresAt: notificationData.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
            });

            console.log(`📬 Notification sent to user ${userId}: ${notificationData.title}`);
            return notification;
        } catch (error) {
            console.error('❌ Failed to send notification:', error);
            // Don't throw - notification failure shouldn't break the flow
            return null;
        }
    }

    /**
     * Send notification to multiple users
     */
    async sendToMany(userIds, notificationData) {
        const notifications = [];
        
        for (const userId of userIds) {
            const notification = await this.sendToUser(userId, notificationData);
            if (notification) {
                notifications.push(notification);
            }
        }
        
        console.log(`📬 Sent notifications to ${notifications.length}/${userIds.length} users`);
        return notifications;
    }

    /**
     * Send refund notification with multi-language support
     */
    async sendRefundNotification(userId, amount, gameNumber, reason) {
        // Get user for language preference (optional)
        const User = require('../models/User');
        const user = await User.findById(userId).select('preferredLanguage');
        const lang = user?.preferredLanguage || 'en';
        
        return this.sendToUser(userId, {
            type: 'refund',
            title: '💰 Refund Processed',
            titleAm: 'ተመላሽ ገንዘብ ተከፍሏል',
            titleTg: 'ገንዘብ ተመላሽ ተደርጓል',
            
            message: `Your ${amount} ETB has been refunded for Game #${gameNumber}. ${reason} A new game will start shortly.`,
            messageAm: `${amount} ብር ለጨዋታ #${gameNumber} ተመላሽ ተደርጓል። ${reason} አዲስ ጨዋታ በቅርቡ ይጀምራል።`,
            messageTg: `ናይ ${amount} ብር ንጸወታ #${gameNumber} ተመሊሱ። ${reason} ሓድሽ ጸወታ ኣብ ቀረባ እዋን ክጅምር እዩ።`,
            
            priority: 'high',
            amount: amount,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
        });
    }

    /**
     * Send game cancelled notification
     */
    async sendGameCancelledNotification(userId, gameNumber) {
        return this.sendToUser(userId, {
            type: 'game_cancelled',
            title: '🎮 Game Cancelled',
            titleAm: 'ጨዋታ ተሰርዟል',
            titleTg: 'ጸወታ ተሰሪዙ',
            
            message: `Game #${gameNumber} was interrupted due to a server restart. All cards have been refunded. Please purchase new cards for the next game.`,
            messageAm: `ጨዋታ #${gameNumber} በአገልጋይ ዳግም ማስጀመር ምክንያት ተቋርጧል። ሁሉም ካርዶች ተመላሽ ተደርገዋል። እባክዎ ለሚቀጥለው ጨዋታ አዲስ ካርዶች ይግዙ።`,
            messageTg: `ጸወታ #${gameNumber} ብምኽንያት ዳግማይ ምጅማር ኣገልጋሊ ተቋሪጹ። ኩሎም ካርድታት ተመሊሶም። በጃኹም ንዝቕጽል ጸወታ ሓደሽቲ ካርድታት ግዘኡ።`,
            
            priority: 'high'
        });
    }

    /**
     * Send game resumed notification
     */
    async sendGameResumedNotification(userId, gameNumber) {
        return this.sendToUser(userId, {
            type: 'game_resumed',
            title: '▶️ Game Resumed',
            titleAm: 'ጨዋታ ቀጥሏል',
            titleTg: 'ጸወታ ቀጺሉ',
            
            message: `Game #${gameNumber} has been resumed after a brief interruption. Your cards are still active.`,
            messageAm: `ጨዋታ #${gameNumber} ከአጭር መቋረጥ በኋላ ቀጥሏል። ካርዶችዎ አሁንም ንቁ ናቸው።`,
            messageTg: `ጸወታ #${gameNumber} ድሕሪ ሓጺር ምቁራጽ ቀጺሉ። ካርድታትኩም ገና ንጡፋት እዮም።`,
            
            priority: 'high'
        });
    }

    /**
     * Send winnings notification
     */
    async sendWinningNotification(userId, amount, gameNumber, winType) {
        return this.sendToUser(userId, {
            type: 'winning',
            title: '🎉 Congratulations! You Won!',
            titleAm: 'እንኳን ደስ አለዎ! አሸንፈዋል!',
            titleTg: 'እንቋዕ ሓጎሰኩም! ተዓዊትኩም!',
            
            message: `You won ${amount} ETB in Game #${gameNumber} with a ${winType}! The prize has been added to your wallet.`,
            messageAm: `በጨዋታ #${gameNumber} ${amount} ብር አሸንፈዋል! ሽልማቱ ወደ ኪስዎ ተጨምሯል።`,
            messageTg: `ኣብ ጸወታ #${gameNumber} ${amount} ብር ተዓዊትኩም! እቲ ሽልማት ናብ ቦርሳኹም ተወሰኸ።`,
            
            priority: 'high',
            amount: amount
        });
    }
}

// Export as singleton
module.exports = new NotificationService();