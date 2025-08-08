import { Router } from 'express';
import type { Request, Response } from 'express';
import fetch from 'node-fetch';

export const renderRouter = Router();

// Trigger Render deploy hook for a given service.
renderRouter.post('/deploy', async (req: Request, res: Response) => {
  const { service = 'serafina' } = req.body || {};
  const hook = process.env[`RENDER_DEPLOY_HOOK_${service.toUpperCase()}` as any] || process.env.RENDER_DEPLOY_HOOK_SERAFINA;
  if (!hook) return res.status(400).json({ ok: false, error: 'No deploy hook configured' });
  const r = await fetch(hook, { method: 'POST' });
  res.json({ ok: r.ok, status: r.status });
});

export default renderRouter;
