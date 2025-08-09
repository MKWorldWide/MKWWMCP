import { Router } from 'express';
import { authenticate, requireAdmin, requireOperator } from '../../middleware/roles.js';
import { auditLogger, auditAction } from '../../middleware/audit.js';
import { strictRateLimit, userRateLimit } from '../../middleware/rateLimit.js';
import { logger } from '../../utils/logger.js';
import { ServiceManager } from '../../services/serviceManager.js';

const router = Router();

// Apply authentication and audit logging to all service routes
router.use(authenticate, auditLogger);

/**
 * @swagger
 * tags:
 *   name: Services
 *   description: MCP Service Management
 */

/**
 * @swagger
 * /mcp/services:
 *   get:
 *     summary: List all services
 *     tags: [Services]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of all services with their status
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
 *                     $ref: '#/components/schemas/ServiceStatus'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get('/', requireOperator, userRateLimit(50), async (req, res) => {
  try {
    const services = await ServiceManager.listServices();
    res.json({ success: true, data: services });
  } catch (error) {
    logger.error('Failed to list services', { error });
    res.status(500).json({ 
      success: false, 
      error: 'Failed to retrieve service status' 
    });
  }
});

/**
 * @swagger
 * /mcp/services/{serviceId}:
 *   get:
 *     summary: Get service status by ID
 *     tags: [Services]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: serviceId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the service to check
 *     responses:
 *       200:
 *         description: Service status
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ServiceStatus'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         description: Service not found
 */
router.get('/:serviceId', requireOperator, userRateLimit(100), async (req, res) => {
  try {
    const { serviceId } = req.params;
    const status = await ServiceManager.getServiceStatus(serviceId);
    
    if (!status) {
      return res.status(404).json({ 
        success: false, 
        error: 'Service not found' 
      });
    }
    
    res.json({ success: true, data: status });
  } catch (error) {
    logger.error('Failed to get service status', { 
      serviceId: req.params.serviceId, 
      error 
    });
    res.status(500).json({ 
      success: false, 
      error: 'Failed to retrieve service status' 
    });
  }
});

/**
 * @swagger
 * /mcp/services/{serviceId}/restart:
 *   post:
 *     summary: Restart a service
 *     tags: [Services]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: serviceId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the service to restart
 *     requestBody:
 *       description: Optional restart options
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               force:
 *                 type: boolean
 *                 description: Force restart even if service appears healthy
 *               timeout:
 *                 type: number
 *                 description: Timeout in milliseconds
 *     responses:
 *       200:
 *         description: Service restarted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ServiceStatus'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         description: Service not found
 *       500:
 *         description: Failed to restart service
 */
router.post('/:serviceId/restart', 
  requireAdmin, 
  strictRateLimit,
  auditAction('service_restart'),
  async (req, res) => {
    const { serviceId } = req.params;
    const { force = false, timeout = 5000 } = req.body;
    
    try {
      const result = await ServiceManager.restartService(serviceId, { 
        force, 
        timeout 
      });
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error || 'Failed to restart service'
        });
      }
      
      res.json({ 
        success: true, 
        message: `Service ${serviceId} restarted successfully`,
        data: result.status
      });
      
    } catch (error) {
      logger.error('Failed to restart service', { 
        serviceId, 
        error,
        userId: req.user?.userId 
      });
      
      res.status(500).json({ 
        success: false, 
        error: 'Failed to restart service' 
      });
    }
  }
);

export default router;
