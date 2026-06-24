// logger.js - Better than console.log
const fs = require('fs');
const path = require('path');

class Logger {
    constructor() {
        this.logDir = path.join(__dirname, '../../logs');
        
        // Create logs directory if it doesn't exist
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
        
        this.levels = {
            ERROR: '🔴',
            WARN: '🟡',
            INFO: '🔵',
            DEBUG: '⚪',
            GAME: '🎮',
            MONEY: '💰'
        };
    }
    
    log(level, message, data = {}) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            message,
            ...data
        };
        
        // Console output with emoji
        const emoji = this.levels[level] || '📝';
        console.log(`${emoji} [${timestamp}] [${level}] ${message}`, data);
        
        // Write to file for important events
        if (level === 'ERROR' || level === 'MONEY') {
            this.writeToFile(level, logEntry);
        }
    }
    
    writeToFile(level, logEntry) {
        const fileName = `${level.toLowerCase()}_${new Date().toISOString().split('T')[0]}.log`;
        const filePath = path.join(this.logDir, fileName);
        
        fs.appendFileSync(
            filePath,
            JSON.stringify(logEntry) + '\n',
            'utf8'
        );
    }
    
    // Convenience methods
    error(message, data) { this.log('ERROR', message, data); }
    warn(message, data) { this.log('WARN', message, data); }
    info(message, data) { this.log('INFO', message, data); }
    debug(message, data) { this.log('DEBUG', message, data); }
    game(message, data) { this.log('GAME', message, data); }
    money(message, data) { this.log('MONEY', message, data); }
}

module.exports = new Logger();