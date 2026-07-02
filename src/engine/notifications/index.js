const Notification = require('../../models/Notification');

class NotificationService {
  constructor(engine) {
    this.engine = engine;
  }

  async send(userId, data) {
    try {
      console.log(`📧 Sending notification to ${userId}: ${data.title}`);
      const notification = await Notification.create({
        user: userId, type: data.type || 'system',
        title: data.title, titleAm: data.titleAm, titleTg: data.titleTg,
        message: data.message, messageAm: data.messageAm, messageTg: data.messageTg,
        priority: data.priority || 'normal', amount: data.amount,
        expiresAt: data.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      });
      const socket = this.engine.getUserSocket(userId);
      if (socket) {
        socket.emit('newNotification', notification);
      }
      return notification;
    } catch (e) {
      console.error(`❌ Failed to send notification: ${e.message}`);
      return null;
    }
  }

  sendRefund(uid, amt, gn, reason) {
    console.log(`💸 Sending refund notification to ${uid}: ${amt} ETB for Game #${gn}`);
    return this.send(uid, {
      type: 'refund', title: 'Refund Processed',
      titleAm: 'ተመላሽ ገንዘብ ተከፍሏል', titleTg: 'ገንዘብ ተመላሽ ተደርጓል',
      message: `Your ${amt} ETB refunded for Game #${gn}. ${reason}`,
      messageAm: `${amt} ብር ለጨዋታ #${gn} ተመላሽ ተደርጓል።`,
      messageTg: `ናይ ${amt} ብር ንጸወታ #${gn} ተመሊሱ።`,
      priority: 'high', amount: amt
    });
  }

  sendGameCancelled(uid, gn) {
    console.log(`🚫 Sending game cancelled notification to ${uid}: Game #${gn}`);
    return this.send(uid, {
      type: 'game_cancelled', title: 'Game Cancelled',
      titleAm: 'ጨዋታ ተሰርዟል', titleTg: 'ጸወታ ተሰሪዙ',
      message: `Game #${gn} interrupted. Cards refunded.`,
      messageAm: `ጨዋታ #${gn} ተቋርጧል።`,
      messageTg: `ጸወታ #${gn} ተቋሪጹ።`,
      priority: 'high'
    });
  }

  sendWinning(uid, amt, gn, wt) {
    console.log(`🏆 Sending winning notification to ${uid}: ${amt} ETB for Game #${gn} (${wt})`);
    return this.send(uid, {
      type: 'winning', title: 'You Won!',
      titleAm: 'አሸንፈዋል!', titleTg: 'ተዓዊትኩም!',
      message: `You won ${amt} ETB in Game #${gn} (${wt})!`,
      messageAm: `${amt} ብር አሸንፈዋል (${wt})!`,
      messageTg: `${amt} ብር ተዓዊትኩም (${wt})!`,
      priority: 'high', amount: amt
    });
  }
}

module.exports = NotificationService;