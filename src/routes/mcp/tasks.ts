import { Router } from 'express';
import { authenticate, requireAdmin, requireOperator } from '../../middleware/roles.js';
import { auditLogger, auditAction } from '../../middleware/audit.js';
import { userRateLimit, strictRateLimit } from '../../middleware/rateLimit.js';
import { logger } from '../../utils/logger.js';
import { TaskManager } from '../../services/taskManager.js';

const router = Router();

// Apply authentication and audit logging to all task routes
router.use(authenticate, auditLogger);

/**
 * @swagger
 * tags:
 *   name: Tasks
 *   description: MCP Task Queue Management
 *
 * components:
 *   schemas:
 *     Task:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *           description: Unique identifier for the task
 *         type:
 *           type: string
 *           description: Type/category of the task
 *         status:
 *           type: string
 *           enum: [pending, in_progress, completed, failed, cancelled]
 *           description: Current status of the task
 *         priority:
 *           type: integer
 *           minimum: 1
 *           maximum: 5
 *           description: Task priority (1=highest, 5=lowest)
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: When the task was created
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: When the task was last updated
 *         createdBy:
 *           type: string
 *           description: ID of the user who created the task
 *         assignedTo:
 *           type: string
 *           description: ID of the user/agent assigned to the task
 *         metadata:
 *           type: object
 *           additionalProperties: true
 *           description: Additional task-specific data
 *         result:
 *           type: object
 *           additionalProperties: true
 *           description: Task execution result
 *         error:
 *           type: string
 *           description: Error message if the task failed
 *         retryCount:
 *           type: integer
 *           description: Number of times the task has been retried
 *         maxRetries:
 *           type: integer
 *           description: Maximum number of retry attempts
 */

/**
 * @swagger
 * /mcp/tasks:
 *   get:
 *     summary: List tasks with optional filtering
 *     tags: [Tasks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, in_progress, completed, failed, cancelled]
 *         description: Filter tasks by status
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Filter tasks by type
 *       - in: query
 *         name: assignedTo
 *         schema:
 *           type: string
 *         description: Filter tasks assigned to a specific user/agent
 *       - in: query
 *         name: createdBy
 *         schema:
 *           type: string
 *         description: Filter tasks created by a specific user
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Maximum number of tasks to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *         description: Number of tasks to skip for pagination
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [createdAt, updatedAt, priority]
 *           default: createdAt
 *         description: Field to sort by
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort order
 *     responses:
 *       200:
 *         description: List of tasks
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
 *                     $ref: '#/components/schemas/Task'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     offset:
 *                       type: integer
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get('/', requireOperator, userRateLimit(100), async (req, res) => {
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
    } = req.query;

    const filter = {
      ...(status && { status }),
      ...(type && { type }),
      ...(assignedTo && { assignedTo: assignedTo as string }),
      ...(createdBy && { createdBy: createdBy as string }),
    };

    const result = await TaskManager.getTasks({
      filter,
      limit: parseInt(limit as string, 10),
      offset: parseInt(offset as string, 10),
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

/**
 * @swagger
 * /mcp/tasks/{taskId}:
 *   get:
 *     summary: Get task by ID
 *     tags: [Tasks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the task to retrieve
 *     responses:
 *       200:
 *         description: Task details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Task'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         description: Task not found
 */
router.get('/:taskId', requireOperator, userRateLimit(100), async (req, res) => {
  try {
    const { taskId } = req.params;
    const task = await TaskManager.getTask(taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found',
      });
    }

    res.json({
      success: true,
      data: task,
    });
  } catch (error) {
    logger.error('Failed to fetch task', { taskId: req.params.taskId, error });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch task',
    });
  }
});

/**
 * @swagger
 * /mcp/tasks:
 *   post:
 *     summary: Create a new task
 *     tags: [Tasks]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *             properties:
 *               type:
 *                 type: string
 *                 description: Type/category of the task
 *               priority:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 5
 *                 default: 3
 *                 description: Task priority (1=highest, 5=lowest)
 *               assignedTo:
 *                 type: string
 *                 description: ID of the user/agent to assign the task to
 *               metadata:
 *                 type: object
 *                 additionalProperties: true
 *                 description: Additional task-specific data
 *               maxRetries:
 *                 type: integer
 *                 minimum: 0
 *                 default: 3
 *                 description: Maximum number of retry attempts
 *     responses:
 *       201:
 *         description: Task created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Task'
 *       400:
 *         description: Invalid request body
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.post('/', requireOperator, userRateLimit(50), async (req, res) => {
  try {
    const { type, priority = 3, assignedTo, metadata, maxRetries = 3 } = req.body;

    if (!type) {
      return res.status(400).json({
        success: false,
        error: 'Task type is required',
      });
    }

    const task = await TaskManager.createTask({
      type,
      priority,
      createdBy: req.user?.userId || 'system',
      assignedTo,
      metadata,
      maxRetries,
    });

    res.status(201).json({
      success: true,
      data: task,
    });
  } catch (error) {
    logger.error('Failed to create task', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to create task',
    });
  }
});

/**
 * @swagger
 * /mcp/tasks/{taskId}/cancel:
 *   post:
 *     summary: Cancel a pending or in-progress task
 *     tags: [Tasks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the task to cancel
 *     responses:
 *       200:
 *         description: Task cancelled successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Task'
 *       400:
 *         description: Task cannot be cancelled
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         description: Task not found
 */
router.post('/:taskId/cancel', requireOperator, strictRateLimit, async (req, res) => {
  try {
    const { taskId } = req.params;
    const task = await TaskManager.cancelTask(taskId, req.user?.userId);

    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found or already completed',
      });
    }

    res.json({
      success: true,
      data: task,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to cancel task', { taskId: req.params.taskId, error: errorMessage });
    
    res.status(500).json({
      success: false,
      error: 'Failed to cancel task',
    });
  }
});

export default router;
