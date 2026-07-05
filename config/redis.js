const Redis = require('ioredis');

let redis;

if (process.env.REDIS_URL) {
  // Use the full URL directly
  redis = new Redis(process.env.REDIS_URL, {
    retryStrategy: (times) => {
      if (times > 3) {
        console.log('⚠️ Redis not available, continuing without cache');
        return null;
      }
      return Math.min(times * 200, 2000);
    },
    maxRetriesPerRequest: 1,
  });
} else if (process.env.REDIS_HOST) {
  redis = new Redis({
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
  });
} else {
  console.log('⚠️ No Redis configured, running without cache');
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

redis.on('connect', () => console.log('✅ Redis connected'));
redis.on('error', (err) => console.warn('⚠️ Redis error:', err.message));

module.exports = redis;