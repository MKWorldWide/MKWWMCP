import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { ideasRouter } from './routes/ideas.js';
import { tasksRouter } from './routes/tasks.js';
import { discordRouter } from './routes/integrations.discord.js';
import { githubRouter } from './routes/integrations.github.js';
import { renderRouter } from './routes/integrations.render.js';
import { oscRouter } from './routes/integrations.osc.js';
import { runsRouter } from './routes/runs.js';
import { githubWebhookRouter } from './routes/webhooks.github.js';
import { requireAuth } from './middleware/auth.js';
import { startTaskWorker } from './workers/taskWorker.js';
import { initDb } from './models/store.js';

// Express bootstrap. Future: swap to Fastify if perf demands.
const app = express();
const limiter = rateLimit({ windowMs: 60_000, max: 60 });
app.use(cors());
app.use(limiter);

// Webhook must receive raw body for HMAC validation before JSON parsing.
app.use('/webhooks/github', express.raw({ type: 'application/json' }), githubWebhookRouter);
app.use(express.json());

// Health check for deployment verifications.
app.get('/health', (_req, res) => res.status(200).send('ok'));
// Apply JWT auth to all subsequent routes.
app.use(requireAuth);
app.use('/ideas', ideasRouter);
app.use('/tasks', tasksRouter);
app.use('/runs', runsRouter);
app.use('/integrations/discord', discordRouter);
app.use('/integrations/github', githubRouter);
app.use('/integrations/render', renderRouter);
app.use('/integrations/vrc/osc', oscRouter);

await initDb();
startTaskWorker();

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`🧠 MCP listening on :${PORT}`));
