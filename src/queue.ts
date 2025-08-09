import { Queue } from 'bullmq';
import * as Redis from 'ioredis';
import { logger } from './utils/logger.js';

// Ensure REDIS_URL is set
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6380/0';

// Create Redis connection with retry strategy
const connection = new Redis.Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy: (times: number): number => {
    const delay = Math.min(times * 1000, 5000);
    logger.warn(`Redis connection attempt ${times}, retrying in ${delay}ms`);
    return delay;
  },
  reconnectOnError: (err: Error): boolean => {
    logger.error('Redis connection error:', err);
    return true; // Reconnect on all errors
  }
});

// Handle connection events
connection.on('connect', () => {
  logger.info('Redis connection established');
});

connection.on('error', (err: Error) => {
  logger.error('Redis connection error:', err);
});

// Create queue with connection
const taskQueue = new Queue('mcp-tasks', { 
  connection: connection as any, // Type assertion to fix type mismatch
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 1000,
  }
});

export { connection, taskQueue };
