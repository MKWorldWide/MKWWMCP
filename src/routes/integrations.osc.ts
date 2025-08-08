import { Router } from 'express';
import type { Request, Response } from 'express';

export const oscRouter = Router();

// Placeholder endpoint for OSC bridge integration.
oscRouter.post('/', async (req: Request, res: Response) => {
  const { address, value } = req.body || {};
  console.log('OSC →', address, value); // TODO: implement OSC client
  res.json({ ok: true });
});

export default oscRouter;
