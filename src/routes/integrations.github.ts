import { Router } from 'express';
import type { Request, Response } from 'express';
import fetch from 'node-fetch';

export const githubRouter = Router();

// Lightweight GitHub repository_dispatch wrapper.
githubRouter.post('/dispatch', async (req: Request, res: Response) => {
  const { repo, event_type, client_payload } = req.body || {};
  const pat = process.env.GH_PAT;
  const r = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ event_type, client_payload }),
  });
  res.json({ ok: r.ok, status: r.status });
});

export default githubRouter;
