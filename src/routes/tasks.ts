import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Task, Run } from '../models/store.js';
import { push, newId, getAll } from '../models/store.js';
import { taskQueue } from '../queue.js';

export const tasksRouter = Router();

// Enqueue plan steps into discrete tasks and hand off to BullMQ worker.
export async function enqueuePlan(ideaId: string | undefined, plan: string, steps: string[]) {
  const run: Run = {
    id: await newId('run'),
    plan,
    steps,
    logs: [],
    startedAt: new Date().toISOString(),
    ...(ideaId ? { ideaId } : {}),
  } as Run;
  await push('runs', run);

  for (const s of steps) {
    const task: Task = {
      id: await newId('task'),
      kind: s.startsWith('deploy:') ? 'deploy' : s.startsWith('post:') ? 'post' : 'dispatch',
      payload: { step: s },
      status: 'queued',
      runId: run.id,
    };
    await push('tasks', task);
    // Jobs retried up to 3 times with exponential backoff.
    await taskQueue.add(
      'exec',
      { taskId: task.id, step: s, runId: run.id },
      { attempts: 3, backoff: { type: 'exponential', delay: 1000 } }
    );
  }
  return run;
}

// Debug endpoint to list all tasks in store.
tasksRouter.get('/', async (_req: Request, res: Response) => res.json({ tasks: await getAll('tasks') }));

export default tasksRouter;
