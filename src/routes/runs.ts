import { Router } from 'express';
import type { Request, Response } from 'express';
import { getRun } from '../models/store.js';

export const runsRouter = Router();

// Fetch a specific run by id, returning its logs and plan.
runsRouter.get('/:id', async (req: Request<{ id: string }>, res: Response) => {
  const run = await getRun(req.params.id);
  if (!run) return res.status(404).json({ ok: false, error: 'Run not found' });
  res.json({ ok: true, run });
});

export default runsRouter;
