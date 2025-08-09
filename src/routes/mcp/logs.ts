import { Router } from 'express';
import { authenticate, requireAdmin, requireOperator } from '../../middleware/roles.js';
import { auditLogger } from '../../middleware/audit.js';
import { userRateLimit } from '../../middleware/rateLimit.js';
import { logger } from '../../utils/logger.js';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { WebSocketService } from '../../services/webSocketService.js';

const router = Router();

// Apply authentication and audit logging to all log routes
router.use(authenticate, auditLogger);

// WebSocket server for real-time log streaming
const httpServer = createServer();
const wss = new WebSocketServer({ noServer: true });

// Upgrade HTTP to WebSocket
httpServer.on('upgrade', (request, socket, head) => {
  // Authenticate WebSocket connection
  authenticateWebSocket(request, (err, user) => {
    if (err || !user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, user);
    });
  });
});

// WebSocket connection handler
wss.on('connection', (ws, req, user) => {
  logger.info('New WebSocket connection for logs', { userId: user.userId });

  // Send initial connection message
  ws.send(JSON.stringify({
    type: 'connection_established',
    timestamp: new Date().toISOString(),
    message: 'Connected to log streaming service'
  }));

  // Handle incoming messages (e.g., filter changes)
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      
      // Handle different types of messages
      switch (data.type) {
        case 'filter':
          // Update log filters based on client request
          logger.debug('Updated log filters', { 
            userId: user.userId, 
            filters: data.filters 
          });
          // In a real implementation, you would update the log stream filters
          break;
          
        case 'ping':
          // Respond to ping with pong
          ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
          break;
          
        default:
          logger.warn('Unknown WebSocket message type', { 
            type: data.type,
            userId: user.userId 
          });
      }
    } catch (error) {
      logger.error('Error processing WebSocket message', { error });
    }
  });

  // Handle client disconnection
  ws.on('close', () => {
    logger.info('WebSocket connection closed', { userId: user.userId });
  });

  // Handle errors
  ws.on('error', (error) => {
    logger.error('WebSocket error', { error, userId: user.userId });
  });
});

// Start the HTTP server (WebSocket server)
const PORT = process.env.LOG_STREAM_PORT || 3001;
httpServer.listen(PORT, () => {
  logger.info(`Log streaming WebSocket server running on port ${PORT}`);
});

/**
 * Authenticate WebSocket connection using JWT from query params
 */
function authenticateWebSocket(
  request: any, 
  callback: (err: Error | null, user?: { userId: string; role: string }) => void
) {
  try {
    // Extract token from query parameters
    const token = new URL(request.url, `http://${request.headers.host}`)
      .searchParams.get('token');
      
    if (!token) {
      throw new Error('No token provided');
    }

    // Verify the token (using the same JWT verification as HTTP routes)
    const decoded = verifyToken(token);
    
    // Check if user has required permissions
    if (!decoded.userId || !decoded.role) {
      throw new Error('Invalid token payload');
    }
    
    // In a real implementation, you might want to validate the user's permissions
    // and check if they have access to the requested logs
    
    callback(null, {
      userId: decoded.userId,
      role: decoded.role
    });
  } catch (error) {
    logger.error('WebSocket authentication failed', { error });
    callback(new Error('Authentication failed'));
  }
}

/**
 * @swagger
 * /mcp/logs:
 *   get:
 *     summary: Get historical logs with filtering
 *     tags: [Logs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: service
 *         schema:
 *           type: string
 *         description: Filter logs by service name
 *       - in: query
 *         name: level
 *         schema:
 *           type: string
 *           enum: [error, warn, info, debug]
 *         description: Filter logs by log level
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter logs after this timestamp (ISO 8601)
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter logs before this timestamp (ISO 8601)
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search term to filter log messages
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 1000
 *           default: 100
 *         description: Maximum number of log entries to return
 *     responses:
 *       200:
 *         description: List of log entries
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/LogEntry'
 *       400:
 *         description: Invalid query parameters
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get('/', requireOperator, userRateLimit(30), async (req, res) => {
  try {
    const { 
      service, 
      level, 
      from, 
      to, 
      search, 
      limit = '100' 
    } = req.query;

    // In a real implementation, you would query your log storage with these filters
    // For this example, we'll return a placeholder response
    
    const logs = [
      {
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'api',
        message: 'Log streaming endpoint accessed',
        metadata: {
          userId: req.user?.userId,
          ip: req.ip,
          userAgent: req.get('user-agent')
        }
      },
      {
        timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString(), // 5 minutes ago
        level: 'debug',
        service: 'worker-1',
        message: 'Processing task 12345',
        metadata: {
          taskId: '12345',
          status: 'in_progress'
        }
      },
      {
        timestamp: new Date(Date.now() - 1000 * 60 * 10).toISOString(), // 10 minutes ago
        level: 'warn',
        service: 'database',
        message: 'Connection pool 75% utilized',
        metadata: {
          current: 15,
          max: 20
        }
      }
    ];

    res.json({
      success: true,
      data: logs
    });
  } catch (error) {
    logger.error('Failed to fetch logs', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch logs'
    });
  }
});

/**
 * @swagger
 * components:
 *   schemas:
 *     LogEntry:
 *       type: object
 *       properties:
 *         timestamp:
 *           type: string
 *           format: date-time
 *           description: When the log entry was created
 *         level:
 *           type: string
 *           enum: [error, warn, info, debug]
 *           description: Log level
 *         service:
 *           type: string
 *           description: Name of the service that generated the log
 *         message:
 *           type: string
 *           description: Log message
 *         metadata:
 *           type: object
 *           additionalProperties: true
 *           description: Additional context or data
 *   responses:
 *     Unauthorized:
 *       description: Unauthorized - Missing or invalid authentication token
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               success:
 *                 type: boolean
 *                 example: false
 *               error:
 *                 type: string
 *                 example: Authentication required
 *     Forbidden:
 *       description: Forbidden - Insufficient permissions
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               success:
 *                 type: boolean
 *                 example: false
 *               error:
 *                 type: string
 *                 example: Insufficient permissions
 */

// Export the WebSocket server for use in other modules
export const logWebSocketServer = wss;

export default router;
