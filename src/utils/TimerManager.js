// TimerManager.js - Clean timer management
class TimerManager {
    constructor() {
        this.timers = new Map();      // Active timers
        this.intervals = new Map();   // Active intervals
        this.stats = {
            created: 0,
            cleared: 0,
            maxActive: 0
        };
        
        // Auto-cleanup check every 5 minutes
        setInterval(() => this.cleanup(), 300000);
        
        // Report stats every hour
        setInterval(() => this.reportStats(), 3600000);
    }
    
    /**
     * Creates a safe timeout that auto-cleans itself
     * @param {string} id - Unique identifier (like roomId)
     * @param {Function} callback - What to do when timer fires
     * @param {number} delay - Delay in milliseconds
     * @param {string} type - Type of timer for debugging
     */
    createTimeout(id, callback, delay, type = 'general') {
        // Clear any existing timer with same ID
        this.clearTimeout(id);
        
        const timerInfo = {
            id: id,
            type: type,
            startedAt: new Date(),
            delay: delay,
            timeoutId: null
        };
        
        // Create the actual timeout
        timerInfo.timeoutId = setTimeout(async () => {
            try {
                console.log(`⏰ Timer fired: ${id} (${type})`);
                await callback();
            } catch (error) {
                console.error(`❌ Timer error (${id}):`, error);
            } finally {
                // Auto-cleanup after execution
                this.timers.delete(id);
                this.stats.cleared++;
                console.log(`✅ Timer cleared: ${id}`);
            }
        }, delay);
        
        this.timers.set(id, timerInfo);
        this.stats.created++;
        
        // Track maximum active timers
        if (this.timers.size > this.stats.maxActive) {
            this.stats.maxActive = this.timers.size;
        }
        
        console.log(`🕐 Timer created: ${id} (${type}), delay: ${delay}ms`);
        return timerInfo;
    }
    
    /**
     * Creates a safe interval that can be stopped
     */
    createInterval(id, callback, interval, type = 'general') {
        // Clear any existing interval
        this.clearInterval(id);
        
        const intervalInfo = {
            id: id,
            type: type,
            startedAt: new Date(),
            interval: interval,
            intervalId: null,
            executionCount: 0,
            maxExecutions: 1000 // Safety limit
        };
        
        intervalInfo.intervalId = setInterval(async () => {
            try {
                intervalInfo.executionCount++;
                
                // Safety check - stop if running too long
                if (intervalInfo.executionCount > intervalInfo.maxExecutions) {
                    console.warn(`⚠️ Interval ${id} reached max executions, clearing`);
                    this.clearInterval(id);
                    return;
                }
                
                await callback();
            } catch (error) {
                console.error(`❌ Interval error (${id}):`, error);
                // Don't clear interval on error - it might be temporary
            }
        }, interval);
        
        this.intervals.set(id, intervalInfo);
        console.log(`🔄 Interval created: ${id} (${type}), every ${interval}ms`);
        return intervalInfo;
    }
    
    /**
     * Clears a specific timeout
     */
    clearTimeout(id) {
        const timer = this.timers.get(id);
        if (timer && timer.timeoutId) {
            clearTimeout(timer.timeoutId);
            this.timers.delete(id);
            this.stats.cleared++;
            console.log(`🧹 Timer cleared: ${id}`);
            return true;
        }
        return false;
    }
    
    /**
     * Clears a specific interval
     */
    clearInterval(id) {
        const interval = this.intervals.get(id);
        if (interval && interval.intervalId) {
            clearInterval(interval.intervalId);
            this.intervals.delete(id);
            console.log(`🧹 Interval cleared: ${id}`);
            return true;
        }
        return false;
    }
    
    /**
     * Clean up stale timers (running more than 1 hour)
     */
    cleanup() {
        const oneHourAgo = Date.now() - 3600000;
        let cleaned = 0;
        
        for (const [id, timer] of this.timers) {
            if (timer.startedAt.getTime() < oneHourAgo) {
                clearTimeout(timer.timeoutId);
                this.timers.delete(id);
                cleaned++;
            }
        }
        
        for (const [id, interval] of this.intervals) {
            if (interval.startedAt.getTime() < oneHourAgo) {
                clearInterval(interval.intervalId);
                this.intervals.delete(id);
                cleaned++;
            }
        }
        
        if (cleaned > 0) {
            console.log(`🧹 Cleanup: removed ${cleaned} stale timers`);
        }
    }
    
    /**
     * Get current stats
     */
    getStats() {
        return {
            ...this.stats,
            activeTimers: this.timers.size,
            activeIntervals: this.intervals.size,
            timerIds: Array.from(this.timers.keys()),
            intervalIds: Array.from(this.intervals.keys())
        };
    }
    
    /**
     * Report stats to console
     */
    reportStats() {
        const stats = this.getStats();
        console.log('📊 Timer Stats:', {
            activeTimers: stats.activeTimers,
            activeIntervals: stats.activeIntervals,
            totalCreated: stats.created,
            totalCleared: stats.cleared,
            maxActive: stats.maxActive
        });
    }
    
    /**
     * Emergency cleanup - clear everything
     */
    emergencyCleanup() {
        console.warn('🚨 Emergency timer cleanup initiated');
        
        for (const [id, timer] of this.timers) {
            clearTimeout(timer.timeoutId);
        }
        for (const [id, interval] of this.intervals) {
            clearInterval(interval.intervalId);
        }
        
        this.timers.clear();
        this.intervals.clear();
        console.log('✅ All timers cleared');
    }
}

// Export as singleton (only one instance in the app)
module.exports = new TimerManager();