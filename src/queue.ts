import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

// Shared Redis connection for queues/workers.
export const connection = new Redis(process.env.REDIS_URL || '');

// Primary task queue; jobs represent execution steps derived from plans.
export const taskQueue = new Queue('mcp-tasks', { connection });
