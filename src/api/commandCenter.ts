import express, { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { authenticate, requireAdmin, requireOperator } from '../middleware/roles.js';
import { auditLogger, auditAction } from '../middleware/audit.js';
import { userRateLimit, strictRateLimit } from '../middleware/rateLimit.js';
import { logger } from '../utils/logger.js';
import { mcp } from '../core/mcp.js';
import { serviceManager } from '../services/serviceManager.js';
import { taskManager } from '../services/taskManager.js';
import { serveSwaggerUI, serveOpenApiJson } from '../utils/swagger.js';

/**
 * Command Center API Router
 * 
 * This router provides endpoints for monitoring and controlling the MCP server,
 * including service management, task orchestration, and system monitoring.
 */
const router: Router = Router();

// Apply global middleware
router.use(express.json());
router.use(express.urlencoded({ extended: true }));

// API Documentation
router.get('/docs', ...serveSwaggerUI());
router.get('/docs.json', serveOpenApiJson);

// Health Check Endpoint
router.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version,
    environment: process.env.NODE_ENV || 'development',
  });
});

// System Status Endpoint
router.get(
  '/status',
  authenticate,
  userRateLimit(60),
  async (req: Request, res: Response) => {
    try {
      const status = mcp.getStatus();
      const services = await serviceManager.listServices();
      const taskStats = await getTaskStatistics();
      
      res.json({
        success: true,
        data: {
          system: {
            status: 'online',
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            cpu: process.cpuUsage(),
            nodeVersion: process.version,
            platform: process.platform,
          },
          services: {
            total: services.length,
            online: services.filter(s => s.status === 'running').length,
            offline: services.filter(s => s.status === 'stopped').length,
            error: services.filter(s => s.status === 'error').length,
          },
          tasks: taskStats,
          connectedBots: status.bots.length,
          lastUpdated: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error('Failed to get system status', { error });
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve system status',
      });
    }
  }
);

// Service Management Endpoints
const servicesRouter = Router();
servicesRouter.use(authenticate, auditLogger);

servicesRouter.get('/', requireOperator, userRateLimit(30), async (req, res) => {
  try {
    const services = await serviceManager.listServices();
    res.json({ success: true, data: services });
  } catch (error) {
    logger.error('Failed to list services', { error });
    res.status(500).json({ success: false, error: 'Failed to retrieve services' });
  }
});

// Service status endpoint with proper type safety
servicesRouter.get('/:serviceId', requireOperator, userRateLimit(60), async (req: Request<{ serviceId: string }>, res: Response) => {
  try {
    const { serviceId } = req.params;
    const service = await serviceManager.getServiceStatus(serviceId);
    
    if (!service) {
      return res.status(404).json({ success: false, error: 'Service not found' });
    }
    
    res.json({ success: true, data: service });
  } catch (error) {
    logger.error('Failed to get service status', { serviceId: req.params.serviceId, error });
    res.status(500).json({ success: false, error: 'Failed to retrieve service status' });
  }
});

servicesRouter.post(
  '/:serviceId/restart',
  requireAdmin,
  strictRateLimit,
  auditAction('service_restart'),
  async (req, res) => {
    try {
      const { serviceId } = req.params;
      const { force = false, timeout = 5000 } = req.body;
      
      const result = await serviceManager.restartService(serviceId, { force, timeout });
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error || 'Failed to restart service',
        });
      }
      
      res.json({
        success: true,
        message: `Service ${serviceId} restarted successfully`,
        data: result.status,
      });
    } catch (error) {
      logger.error('Failed to restart service', { 
        serviceId: req.params.serviceId, 
        error,
        userId: req.user?.userId,
      });
      
      res.status(500).json({ 
        success: false, 
        error: 'Failed to restart service',
      });
    }
  }
);

// Task Management Endpoints
const tasksRouter = Router();
tasksRouter.use(authenticate, auditLogger);

// Task listing endpoint with proper type safety
tasksRouter.get('/', requireOperator, userRateLimit(30), async (req: Request<{}, {}, {}, { status?: string; type?: string; assignedTo?: string; createdBy?: string; limit?: string; offset?: string; sortBy?: string; sortOrder?: 'asc' | 'desc' }>, res: Response) => {
  try {
    const { 
      status, 
      type, 
      assignedTo, 
      createdBy, 
      limit = '20', 
      offset = '0',
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query as {
      status?: string;
      type?: string;
      assignedTo?: string;
      createdBy?: string;
      limit?: string;
      offset?: string;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    };
    
    // Convert query parameters to the correct types
    const filter: Record<string, string> = {};
    if (status) filter.status = status;
    if (type) filter.type = type;
    if (assignedTo) filter.assignedTo = assignedTo;
    if (createdBy) filter.createdBy = createdBy;

    // Ensure we have valid limit and offset values
    const limitValue = limit ? parseInt(limit, 10) : 20;
    const offsetValue = offset ? parseInt(offset, 10) : 0;
    
    const result = await taskManager.getTasks({
      filter,
      limit: limitValue,
      offset: offsetValue,
      sortBy: sortBy as string,
      sortOrder: sortOrder as 'asc' | 'desc',
    });
    
    res.json({
      success: true,
      data: result.tasks,
      pagination: {
        total: result.total,
        limit: parseInt(limit as string, 10),
        offset: parseInt(offset as string, 10),
      },
    });
  } catch (error) {
    logger.error('Failed to fetch tasks', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch tasks',
    });
  }
});

// Mount the routers with proper type assertions
router.use('/services', servicesRouter as express.Router);
router.use('/tasks', tasksRouter as express.Router);

// Helper function to get task statistics with proper error handling
async function getTaskStatistics() {
  let allTasks;
  try {
    allTasks = await taskManager.getTasks({
      filter: {} as Record<string, string>,
      limit: 1000, // Adjust based on expected task volume
      offset: 0,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
  } catch (error) {
    logger.error('Failed to fetch task statistics', { error });
    // Return default values if task manager fails
    return {
      total: 0,
      byStatus: {},
      byType: {},
      recentActivity: {
        lastHour: 0,
        last24Hours: 0,
        completionRate: 0,
      },
    };
  }
  
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  const recentTasks = allTasks.tasks.filter(
    task => new Date(task.createdAt) > oneDayAgo
  );
  
  const stats: {
    total: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
    recentActivity: {
      lastHour: number;
      last24Hours: number;
      completionRate: number;
    };
  } = {
    total: allTasks.total,
    byStatus: {
      pending: allTasks.tasks.filter(t => t.status === 'pending').length,
      in_progress: allTasks.tasks.filter(t => t.status === 'in_progress').length,
      completed: allTasks.tasks.filter(t => t.status === 'completed').length,
      failed: allTasks.tasks.filter(t => t.status === 'failed').length,
      cancelled: allTasks.tasks.filter(t => t.status === 'cancelled').length,
    },
    byType: {},
    recentActivity: {
      lastHour: allTasks.tasks.filter(
        t => new Date(t.updatedAt) > oneHourAgo
      ).length,
      last24Hours: recentTasks.length,
      completionRate: recentTasks.length > 0
        ? (recentTasks.filter(t => t.status === 'completed').length / recentTasks.length) * 100
        : 0,
    },
  };
  
  // Calculate tasks by type with proper type safety
  if (allTasks.tasks) {
    allTasks.tasks.forEach(task => {
      const taskType = task?.type as string | undefined;
      if (taskType) {
        if (!stats.byType[taskType]) {
          stats.byType[taskType] = 0;
        }
        stats.byType[taskType]++;
      }
    });
  }
  
  return stats;
}

export { router as commandCenterRouter };
