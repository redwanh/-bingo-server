const Redis = require('ioredis');

let redis;

if (process.env.REDIS_URL || process.env.REDIS_HOST) {
  redis = new Redis({
    host: process.env.REDIS_HOST || undefined,
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
    retryStrategy: (times) => {
      if (times > 3) {
        console.log('⚠️ Redis not available, continuing without cache');
        return null; // Stop retrying
      }
      return Math.min(times * 200, 2000);
    },
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  
  redis.on('connect', () => console.log('✅ Redis connected'));
  redis.on('error', (err) => {
    console.warn('⚠️ Redis error:', err.message);
    // Don't crash - continue without Redis
  });
} else {
  console.log('⚠️ No Redis configured, running without cache');
  // Create a mock Redis that does nothing
  redis = {
    get: async () => null,
    set: async () => {},
    del: async () => {},
    sadd: async () => {},
    smembers: async () => [],
    sismember: async () => false,
    keys: async () => [],
    on: () => {},
  };
}

module.exports = redis;