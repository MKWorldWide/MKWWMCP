/**
 * OpenAPI/Swagger configuration for the MCP Command Center API
 */

export const openApiConfig = {
  openapi: '3.0.0',
  info: {
    title: 'MCP Command Center API',
    version: '1.0.0',
    description: 'API for monitoring and controlling the MKWorldWide MCP Server',
    contact: {
      name: 'MKWorldWide Support',
      url: 'https://github.com/MKWorldWide/MKWWMCP',
    },
    license: {
      name: 'MIT',
      url: 'https://opensource.org/licenses/MIT',
    },
  },
  servers: [
    {
      url: process.env.API_BASE_URL || 'http://localhost:3000',
      description: process.env.NODE_ENV === 'production' ? 'Production' : 'Development',
    },
  ],
  tags: [
    {
      name: 'Services',
      description: 'Service management endpoints',
    },
    {
      name: 'Tasks',
      description: 'Task queue management',
    },
    {
      name: 'Logs',
      description: 'Log streaming and querying',
    },
    {
      name: 'Broadcast',
      description: 'Real-time messaging and notifications',
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT token for authentication. Format: Bearer <token>',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          success: {
            type: 'boolean',
            example: false,
          },
          error: {
            type: 'string',
            description: 'Error message',
            example: 'Invalid request',
          },
          details: {
            type: 'object',
            description: 'Additional error details',
            additionalProperties: true,
          },
        },
      },
      ServiceStatus: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Unique identifier for the service',
            example: 'api-server',
          },
          name: {
            type: 'string',
            description: 'Display name of the service',
            example: 'API Server',
          },
          status: {
            type: 'string',
            enum: ['running', 'stopped', 'error', 'restarting'],
            description: 'Current status of the service',
          },
          uptime: {
            type: 'number',
            description: 'Uptime in seconds',
            example: 3600,
          },
          cpuUsage: {
            type: 'number',
            description: 'CPU usage percentage',
            example: 45.2,
          },
          memoryUsage: {
            type: 'number',
            description: 'Memory usage in MB',
            example: 256.7,
          },
          lastError: {
            type: 'string',
            description: 'Last error message, if any',
            example: 'Connection timeout',
          },
          lastRestart: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp of last restart',
          },
          version: {
            type: 'string',
            description: 'Service version',
            example: '1.0.0',
          },
        },
      },
      Task: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier for the task',
          },
          type: {
            type: 'string',
            description: 'Type/category of the task',
            example: 'data_sync',
          },
          status: {
            type: 'string',
            enum: ['pending', 'in_progress', 'completed', 'failed', 'cancelled'],
            description: 'Current status of the task',
          },
          priority: {
            type: 'integer',
            minimum: 1,
            maximum: 5,
            description: 'Task priority (1=highest, 5=lowest)',
            example: 3,
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            description: 'When the task was created',
          },
          updatedAt: {
            type: 'string',
            format: 'date-time',
            description: 'When the task was last updated',
          },
          createdBy: {
            type: 'string',
            description: 'ID of the user who created the task',
            example: 'user-123',
          },
          assignedTo: {
            type: 'string',
            description: 'ID of the user/agent assigned to the task',
            example: 'worker-1',
          },
          startedAt: {
            type: 'string',
            format: 'date-time',
            description: 'When the task was started',
          },
          completedAt: {
            type: 'string',
            format: 'date-time',
            description: 'When the task was completed',
          },
          metadata: {
            type: 'object',
            additionalProperties: true,
            description: 'Additional task-specific data',
          },
          result: {
            type: 'object',
            additionalProperties: true,
            description: 'Task execution result',
          },
          error: {
            type: 'string',
            description: 'Error message if the task failed',
          },
          retryCount: {
            type: 'integer',
            minimum: 0,
            description: 'Number of times the task has been retried',
          },
          maxRetries: {
            type: 'integer',
            minimum: 0,
            description: 'Maximum number of retry attempts',
          },
        },
      },
      LogEntry: {
        type: 'object',
        properties: {
          timestamp: {
            type: 'string',
            format: 'date-time',
            description: 'When the log entry was created',
          },
          level: {
            type: 'string',
            enum: ['error', 'warn', 'info', 'debug'],
            description: 'Log level',
          },
          service: {
            type: 'string',
            description: 'Name of the service that generated the log',
            example: 'api',
          },
          message: {
            type: 'string',
            description: 'Log message',
          },
          metadata: {
            type: 'object',
            additionalProperties: true,
            description: 'Additional context or data',
          },
        },
      },
      BroadcastMessage: {
        type: 'object',
        required: ['message', 'target'],
        properties: {
          message: {
            type: 'string',
            description: 'The message content to broadcast',
          },
          target: {
            type: 'string',
            enum: ['all', 'services', 'clients', 'specific'],
            description: 'Target audience for the broadcast',
          },
          targetIds: {
            type: 'array',
            items: {
              type: 'string',
            },
            description: 'Specific service/client IDs to target (required if target is specific)',
          },
          metadata: {
            type: 'object',
            additionalProperties: true,
            description: 'Additional metadata to include with the message',
          },
          priority: {
            type: 'string',
            enum: ['low', 'normal', 'high', 'critical'],
            default: 'normal',
            description: 'Message priority',
          },
          ttl: {
            type: 'integer',
            minimum: 0,
            description: 'Time-to-live in seconds (0 for no expiration)',
          },
        },
      },
    },
    responses: {
      Unauthorized: {
        description: 'Unauthorized - Missing or invalid authentication token',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
            example: {
              success: false,
              error: 'Authentication required',
            },
          },
        },
      },
      Forbidden: {
        description: 'Forbidden - Insufficient permissions',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
            example: {
              success: false,
              error: 'Insufficient permissions',
            },
          },
        },
      },
      NotFound: {
        description: 'The requested resource was not found',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
            example: {
              success: false,
              error: 'Resource not found',
            },
          },
        },
      },
      BadRequest: {
        description: 'Invalid request data',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
            example: {
              success: false,
              error: 'Invalid input data',
              details: {
                field: 'Expected type, got value',
              },
            },
          },
        },
      },
    },
  },
  security: [
    {
      bearerAuth: [],
    },
  ],
} as const;

// Export types for TypeScript
export type OpenApiConfig = typeof openApiConfig;
