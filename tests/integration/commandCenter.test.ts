import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createServer } from 'http';
import express from 'express';
import { WebSocketServer } from 'ws';
import { getAuthHeaders, UserRole } from '../test-utils.js';
import { mcp } from '../../src/core/mcp.js';
import { serviceManager } from '../../src/services/serviceManager.js';
import { taskManager } from '../../src/services/taskManager.js';
import { webSocketService } from '../../src/services/webSocketService.js';
import { createClient } from 'redis';

// Mock logger to prevent console output during tests
vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('Command Center API', () => {
  let app: express.Express;
  let server: ReturnType<typeof createServer>;
  let wsServer: WebSocketServer;
  let baseUrl: string;
  let redisClient: any;

  beforeAll(async () => {
    // Set a longer timeout for the setup (30 seconds)
    const setupTimeout = 30000;
    const startTime = Date.now();
    
    const logWithElapsed = (message: string) => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`[+${elapsed}s] ${message}`);
    };

    logWithElapsed('Starting test setup...');
    
    try {
      // Create Express app
      logWithElapsed('Creating Express app...');
      app = express();
      
      // Create HTTP server
      logWithElapsed('Creating HTTP server...');
      server = createServer(app);
      
      // Create WebSocket server
      logWithElapsed('Creating WebSocket server...');
      wsServer = new WebSocketServer({ noServer: true });
      
      // Initialize Redis client for testing with retry logic
      logWithElapsed('Connecting to Redis...');
      
      // Use host.docker.internal for Docker on Windows to connect to host's localhost
      const redisUrl = 'redis://host.docker.internal:6379';
      logWithElapsed(`Using Redis URL: ${redisUrl}`);
      
      redisClient = createClient({
        url: redisUrl,
        socket: {
          reconnectStrategy: (retries: number) => {
            if (retries > 3) {
              logWithElapsed('Max Redis reconnection attempts reached');
              return new Error('Max reconnection attempts reached');
            }
            logWithElapsed(`Redis reconnection attempt ${retries}`);
            return Math.min(retries * 100, 5000);
          },
          // Add connection timeout
          connectTimeout: 5000
        }
      });
      
      // Add more detailed error handling
      redisClient.on('error', (err: Error) => {
        logWithElapsed(`Redis Client Error: ${err.message}`);
        if (err.stack) {
          logWithElapsed(`Stack: ${err.stack}`);
        }
      });
      
      redisClient.on('ready', () => {
        logWithElapsed('Redis client is ready');
      });
      
      redisClient.on('connect', () => {
        logWithElapsed('Redis client connected');
      });
      
      redisClient.on('reconnecting', () => {
        logWithElapsed('Redis client reconnecting...');
      });
      
      redisClient.on('end', () => {
        logWithElapsed('Redis client connection ended');
      });
      
      // Connect to Redis with more detailed logging
      logWithElapsed('Attempting to connect to Redis...');
      try {
        await redisClient.connect();
        logWithElapsed('Redis client connected successfully');
        
        // Test Redis connection
        const pingResult = await redisClient.ping();
        logWithElapsed(`Redis ping result: ${pingResult}`);
        
        if (pingResult !== 'PONG') {
          throw new Error('Redis connection test failed - did not receive PONG');
        }
        
        logWithElapsed('Redis connection test successful');
        
        // Initialize MCP with the HTTP server
        logWithElapsed('Initializing MCP...');
        
        // Increase timeout for MCP initialization
        await Promise.race([
          mcp.initialize(server, app),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('MCP initialization timeout')), 30000) // Increased to 30s
          )
        ]);
        
        logWithElapsed('MCP initialized successfully');
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logWithElapsed(`Error during Redis/MCP initialization: ${errorMessage}`);
        if (redisClient) {
          logWithElapsed('Redis client state:');
          logWithElapsed(`- isOpen: ${redisClient.isOpen}`);
          logWithElapsed(`- isReady: ${redisClient.isReady}`);
        }
        throw error;
      }
      
      // Start server with timeout
      logWithElapsed('Starting HTTP server...');
      await Promise.race([
        new Promise<void>((resolve) => {
          server.listen(0, () => {
            const address = server.address();
            const port = typeof address === 'string' ? 0 : address?.port || 0;
            baseUrl = `http://localhost:${port}`;
            logWithElapsed(`Server listening on ${baseUrl}`);
            resolve();
          });
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Server start timeout')), 5000)
        )
      ]);
      
      // Handle WebSocket upgrades
      logWithElapsed('Setting up WebSocket upgrade handler...');
      server.on('upgrade', (request, socket, head) => {
        logWithElapsed('WebSocket upgrade requested');
        wsServer.handleUpgrade(request, socket, head, (ws) => {
          logWithElapsed('WebSocket connection established');
          wsServer.emit('connection', ws, request);
        });
      });
      
      logWithElapsed('Test setup completed successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logWithElapsed(`Test setup failed: ${errorMessage}`);
      
      // Clean up resources if they were partially created
      try {
        if (redisClient?.isOpen) {
          await redisClient.quit();
        }
        if (server) {
          server.close();
        }
      } catch (cleanupError) {
        logWithElapsed(`Error during cleanup: ${cleanupError}`);
      }
      
      throw error;
    }
  }, 60000); // 60 second timeout for the entire setup
  
  afterAll(async () => {
    // Clean up
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    }
    
    if (wsServer) {
      wsServer.close();
    }
    
    // Close Redis connection
    if (redisClient) {
      await redisClient.quit();
    }
  });
  
  afterEach(() => {
    vi.clearAllMocks();
  });
  
  describe('Authentication', () => {
    it('should reject unauthenticated requests', async () => {
      const response = await request(baseUrl)
        .get('/api/mcp/status')
        .expect(401);
      
      expect(response.body).toMatchObject({
        success: false,
        error: 'No token provided',
      });
    });
    
    it('should reject invalid tokens', async () => {
      const response = await request(baseUrl)
        .get('/api/mcp/status')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
      
      expect(response.body).toMatchObject({
        success: false,
        error: 'Invalid token',
      });
    });
  });
  
  describe('Service Management', () => {
    it('should list all services (admin)', async () => {
      const response = await request(baseUrl)
        .get('/api/mcp/services')
        .set(getAuthHeaders(UserRole.ADMIN))
        .expect(200);
      
      expect(response.body).toMatchObject({
        success: true,
        data: expect.any(Array),
      });
    });
    
    it('should get service status (operator)', async () => {
      // First, get the list of services to find a valid service ID
      const listResponse = await request(baseUrl)
        .get('/api/mcp/services')
        .set(getAuthHeaders(UserRole.OPERATOR));
      
      const serviceId = listResponse.body.data?.[0]?.id;
      if (!serviceId) {
        throw new Error('No services found to test with');
      }
      
      const response = await request(baseUrl)
        .get(`/api/mcp/services/${serviceId}`)
        .set(getAuthHeaders(UserRole.OPERATOR))
        .expect(200);
      
      expect(response.body).toMatchObject({
        success: true,
        data: {
          id: serviceId,
          status: expect.any(String),
          lastHeartbeat: expect.any(String),
        },
      });
    });
    
    it('should restart a service (admin only)', async () => {
      // First, get the list of services to find a valid service ID
      const listResponse = await request(baseUrl)
        .get('/api/mcp/services')
        .set(getAuthHeaders(UserRole.ADMIN));
      
      const serviceId = listResponse.body.data?.[0]?.id;
      if (!serviceId) {
        throw new Error('No services found to test with');
      }
      
      // Test that operator cannot restart services
      await request(baseUrl)
        .post(`/api/mcp/services/${serviceId}/restart`)
        .set(getAuthHeaders(UserRole.OPERATOR))
        .expect(403);
      
      // Test admin can restart services
      const response = await request(baseUrl)
        .post(`/api/mcp/services/${serviceId}/restart`)
        .set(getAuthHeaders(UserRole.ADMIN))
        .expect(200);
      
      expect(response.body).toMatchObject({
        success: true,
        message: expect.stringContaining('restarting'),
      });
    });
  });
  
  describe('Task Management', () => {
    it('should list tasks with filtering (operator)', async () => {
      const response = await request(baseUrl)
        .get('/api/mcp/tasks')
        .query({ status: 'pending' })
        .set(getAuthHeaders(UserRole.OPERATOR))
        .expect(200);
      
      expect(response.body).toMatchObject({
        success: true,
        data: expect.any(Array),
        pagination: {
          total: expect.any(Number),
          limit: expect.any(Number),
          offset: expect.any(Number),
        },
      });
    });
    
    it('should create a new task (operator)', async () => {
      const taskData = {
        type: 'test-task',
        payload: { test: 'data' },
        priority: 'normal',
      };
      
      const response = await request(baseUrl)
        .post('/api/mcp/tasks')
        .set(getAuthHeaders(UserRole.OPERATOR))
        .send(taskData)
        .expect(201);
      
      expect(response.body).toMatchObject({
        success: true,
        data: {
          id: expect.any(String),
          type: taskData.type,
          status: 'pending',
          priority: taskData.priority,
          createdBy: 'test-operator-1', // From test user
        },
      });
    });
    
    it('should get task details (readonly)', async () => {
      // First, create a test task
      const createResponse = await request(baseUrl)
        .post('/api/mcp/tasks')
        .set(getAuthHeaders(UserRole.OPERATOR))
        .send({
          type: 'test-task',
          payload: { test: 'data' },
        });
      
      const taskId = createResponse.body.data?.id;
      if (!taskId) {
        throw new Error('Failed to create test task');
      }
      
      // Test that readonly user can view the task
      const response = await request(baseUrl)
        .get(`/api/mcp/tasks/${taskId}`)
        .set(getAuthHeaders(UserRole.READONLY))
        .expect(200);
      
      expect(response.body).toMatchObject({
        success: true,
        data: {
          id: taskId,
          type: 'test-task',
          status: 'pending',
        },
      });
    });
  });
  
  describe('System Status', () => {
    it('should get system status (any authenticated user)', async () => {
      const response = await request(baseUrl)
        .get('/api/mcp/status')
        .set(getAuthHeaders(UserRole.READONLY))
        .expect(200);
      
      expect(response.body).toMatchObject({
        success: true,
        data: {
          status: expect.any(String),
          uptime: expect.any(Number),
          services: expect.any(Array),
          tasks: expect.any(Object),
          memory: expect.any(Object),
          cpu: expect.any(Object),
        },
      });
    });
  });
});
