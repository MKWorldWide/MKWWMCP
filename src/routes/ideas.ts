import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { Idea } from '../models/store.js';
import { newId, push } from '../models/store.js';
import { planFromIdea } from '../services/planner.js';
import { enqueuePlan } from './tasks.js';

export const ideasRouter = Router();

// Schema ensures well-formed idea payloads.
const Schema = z.object({
  title: z.string(),
  body: z.string().default(''),
  tags: z.array(z.string()).default([]),
  targets: z.array(z.string()).default([]),
  source: z.string().default('api'),
});

ideasRouter.post('/', async (req: Request, res: Response) => {
  const input = Schema.parse(req.body);
  const idea: Idea = {
    id: await newId('idea'),
    createdAt: new Date().toISOString(),
    ...input,
  };
  await push('ideas', idea);

  const { plan, steps } = planFromIdea(idea);
  const run = await enqueuePlan(idea.id, plan, steps);
  res.json({ ok: true, idea, run });
});

export default ideasRouter;
