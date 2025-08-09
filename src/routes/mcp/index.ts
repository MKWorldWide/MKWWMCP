import { Router } from 'express';
import { authenticate } from '../../middleware/roles.js';
import { auditLogger } from '../../middleware/audit.js';
import servicesRouter from './services.js';
import tasksRouter from './tasks.js';
import logsRouter from './logs.js';
import broadcastRouter from './broadcast.js';

const router = Router();

// Apply authentication and audit logging to all MCP routes
router.use(authenticate, auditLogger);

// Mount the service management routes
router.use('/services', servicesRouter);

// Mount the task management routes
router.use('/tasks', tasksRouter);

// Mount the log streaming routes
router.use('/logs', logsRouter);

// Mount the broadcast messaging routes
router.use('/broadcast', broadcastRouter);

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version,
    environment: process.env.NODE_ENV || 'development',
  });
});

export default router;
