import { Router } from 'express';
import type { Request, Response } from 'express';
import crypto from 'node:crypto';

export const githubWebhookRouter = Router();

githubWebhookRouter.post('/', (req: Request, res: Response) => {
  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  const secret = process.env.HMAC_GITHUB_SECRET || '';
  const body = req.body as Buffer; // raw body provided by express.raw

  const digest = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  if (!signature || !crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature))) {
    return res.status(401).send('Invalid signature');
  }

  // For now just acknowledge receipt; in future dispatch events.
  res.json({ ok: true });
});
