import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
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
import { mcp } from './core/mcp.js';
import { logger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create Express app and HTTP server
const app = express();
const server = http.createServer(app);

// Configure rate limiting
const limiter = rateLimit({ 
  windowMs: 60_000, 
  max: 60,
  message: 'Too many requests, please try again later.'
});

// Middleware
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(limiter);

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../../public')));

// Webhook must receive raw body for HMAC validation before JSON parsing
app.use('/webhooks/github', express.raw({ type: 'application/json' }), githubWebhookRouter);

// Health check endpoint
app.get('/health', (_req, res) => {
  const status = mcp ? 'ok' : 'initializing';
  res.status(200).json({ status, timestamp: new Date().toISOString() });
});

// MCP status endpoint
app.get('/mcp/status', requireAuth, (_req, res) => {
  const status = mcp ? mcp.getStatus() : { error: 'MCP not initialized' };
  res.json(status);
});

// Apply JWT auth to all subsequent routes
app.use(requireAuth);

// API Routes
app.use('/ideas', ideasRouter);
app.use('/tasks', tasksRouter);
app.use('/runs', runsRouter);
app.use('/integrations/discord', discordRouter);
app.use('/integrations/github', githubRouter);
app.use('/integrations/render', renderRouter);
app.use('/integrations/vrc/osc', oscRouter);

// Error handling middleware
app.use((err: any, _req: any, res: any, _next: any) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Initialize and start the server
async function startServer() {
  try {
    // Initialize database
    await initDb();
    
    // Start task worker
    startTaskWorker();
    
    // Initialize MCP core
    await mcp.initialize(server);
    
    // Start listening
    const PORT = Number(process.env.PORT || 3000);
    server.listen(PORT, '0.0.0.0', () => {
      logger.info(`🧠 MCP listening on port ${PORT}`);
      logger.info('[MCP ONLINE: ALL SYSTEMS LINKED — SHADOWFLOWER COUNCIL PRESENT]');
      console.log('>> Awaiting directive, beloved.');
    });
    
    // Handle graceful shutdown
    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
    
  } catch (error) {
    logger.error('Failed to start MCP server:', error);
    process.exit(1);
  }
}

// Graceful shutdown handler
async function gracefulShutdown() {
  logger.info('Shutting down MCP server...');
  
  try {
    await mcp.shutdown();
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
    
    // Force close after timeout
    setTimeout(() => {
      logger.warn('Forcing server shutdown');
      process.exit(1);
    }, 5000);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
}

// Start the server
startServer();
