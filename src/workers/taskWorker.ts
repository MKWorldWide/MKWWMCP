import { Worker } from 'bullmq';
import { connection, redisOptions } from '../queue.js';
import { execStep } from '../services/executor.js';
import { updateTask, appendRunLog } from '../models/store.js';

// Spawns a BullMQ worker to process queued tasks asynchronously.
export function startTaskWorker() {
  return new Worker(
    'mcp-tasks',
    async (job) => {
      const { taskId, step, runId } = job.data as { taskId: string; step: string; runId: string };
      await updateTask(taskId, { status: 'running' });
      const { ok, note } = await execStep(step);
      await updateTask(taskId, { status: ok ? 'done' : 'error' });
      await appendRunLog(runId, note);
    },
    { 
      connection: {
        ...redisOptions,
        // Ensure BullMQ specific options are properly set
        maxRetriesPerRequest: null,
        enableReadyCheck: false
      } 
    }
  );
}
