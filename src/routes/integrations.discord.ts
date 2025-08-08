import { Router } from 'express';
import type { Request, Response } from 'express';
import fetch from 'node-fetch';

export const discordRouter = Router();

// Proxy to Discord webhook so clients don't expose secrets.
discordRouter.post('/post', async (req: Request, res: Response) => {
  const { webhook = process.env.DISCORD_WEBHOOK_COUNCIL, content, embeds } = req.body || {};
  if (!webhook) return res.status(400).json({ ok: false, error: 'Missing webhook' });
  const r = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, embeds }),
  });
  res.json({ ok: r.ok });
});

export default discordRouter;
