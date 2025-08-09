import { Router } from 'express';
import { authenticate, requireAdmin, requireOperator } from '../../middleware/roles.js';
import { auditLogger, auditAction } from '../../middleware/audit.js';
import { strictRateLimit, userRateLimit } from '../../middleware/rateLimit.js';
import { logger } from '../../utils/logger.js';
import { webSocketService } from '../../services/webSocketService.js';

const router = Router();

// Apply authentication and audit logging to all broadcast routes
router.use(authenticate, auditLogger);

/**
 * @swagger
 * tags:
 *   name: Broadcast
 *   description: MCP Broadcast Messaging
 *
 * components:
 *   schemas:
 *     BroadcastMessage:
 *       type: object
 *       required:
 *         - message
 *         - target
 *       properties:
 *         message:
 *           type: string
 *           description: The message content to broadcast
 *         target:
 *           type: string
 *           enum: [all, services, clients, specific]
 *           description: Target audience for the broadcast
 *         targetIds:
 *           type: array
 *           items:
 *             type: string
 *           description: Specific service/client IDs to target (required if target is 'specific')
 *         metadata:
 *           type: object
 *           additionalProperties: true
 *           description: Additional metadata to include with the message
 *         priority:
 *           type: string
 *           enum: [low, normal, high, critical]
 *           default: normal
 *           description: Message priority
 *         ttl:
 *           type: integer
 *           minimum: 0
 *           description: Time-to-live in seconds (0 for no expiration)
 */

/**
 * @swagger
 * /mcp/broadcast:
 *   post:
 *     summary: Broadcast a message to connected clients/services
 *     tags: [Broadcast]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/BroadcastMessage'
 *     responses:
 *       200:
 *         description: Message broadcasted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 recipients:
 *                   type: integer
 *                   description: Number of recipients who received the message
 *       400:
 *         description: Invalid request body or target
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.post(
  '/', 
  requireAdmin, 
  strictRateLimit,
  auditAction('broadcast_message'),
  async (req, res) => {
    try {
      const { 
        message, 
        target = 'all',
        targetIds = [],
        metadata = {},
        priority = 'normal',
        ttl = 0
      } = req.body;

      // Validate required fields
      if (!message) {
        return res.status(400).json({
          success: false,
          error: 'Message is required',
        });
      }

      if (target === 'specific' && (!Array.isArray(targetIds) || targetIds.length === 0)) {
        return res.status(400).json({
          success: false,
          error: 'targetIds is required when target is "specific"',
        });
      }

      // Prepare the broadcast message
      const broadcastMessage = {
        type: 'broadcast',
        timestamp: new Date().toISOString(),
        from: {
          userId: req.user?.userId,
          role: req.user?.role,
        },
        message,
        metadata,
        priority,
        ttl,
      };

      let recipients = 0;
      
      // Send the message to the appropriate targets
      switch (target) {
        case 'all':
          recipients = webSocketService.broadcastToAll(broadcastMessage);
          break;
          
        case 'services':
          recipients = webSocketService.broadcastToServices(broadcastMessage);
          break;
          
        case 'clients':
          recipients = webSocketService.broadcastToClients(broadcastMessage);
          break;
          
        case 'specific':
          recipients = webSocketService.broadcastToConnections(targetIds, broadcastMessage);
          break;
          
        default:
          return res.status(400).json({
            success: false,
            error: 'Invalid target specified',
          });
      }

      // Log the broadcast
      logger.info('Message broadcasted', {
        target,
        targetIds: target === 'specific' ? targetIds : undefined,
        messageLength: message.length,
        recipients,
        userId: req.user?.userId,
      });

      res.json({
        success: true,
        message: 'Message broadcasted successfully',
        recipients,
      });
    } catch (error) {
      logger.error('Failed to broadcast message', { 
        error,
        userId: req.user?.userId,
        target: req.body.target,
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to broadcast message',
      });
    }
  }
);

/**
 * @swagger
 * /mcp/broadcast/connections:
 *   get:
 *     summary: Get information about active WebSocket connections
 *     tags: [Broadcast]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [all, services, clients]
 *           default: all
 *         description: Filter connections by type
 *     responses:
 *       200:
 *         description: List of active connections
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 connections:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       connectionId:
 *                         type: string
 *                       serviceName:
 *                         type: string
 *                       serviceType:
 *                         type: string
 *                       connectedAt:
 *                         type: string
 *                         format: date-time
 *                       lastActivity:
 *                         type: string
 *                         format: date-time
 *                       metadata:
 *                         type: object
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get('/connections', requireOperator, userRateLimit(30), (req, res) => {
  try {
    const { type = 'all' } = req.query;
    
    // Get active connections from WebSocket service
    const connections = webSocketService.getConnections();
    
    // Filter connections by type if specified
    let filteredConnections = connections;
    if (type === 'services') {
      filteredConnections = connections.filter(conn => 
        conn.serviceType === 'service' || conn.serviceType === 'bot'
      );
    } else if (type === 'clients') {
      filteredConnections = connections.filter(conn => 
        conn.serviceType === 'client'
      );
    }
    
    // Format the response
    const formattedConnections = filteredConnections.map(conn => ({
      connectionId: conn.connectionId,
      serviceName: conn.serviceName,
      serviceType: conn.serviceType,
      connectedAt: conn.connectedAt?.toISOString(),
      lastActivity: conn.lastActivity?.toISOString(),
      metadata: conn.metadata,
    }));
    
    res.json({
      success: true,
      connections: formattedConnections,
    });
  } catch (error) {
    logger.error('Failed to get active connections', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve active connections',
    });
  }
});

export default router;
