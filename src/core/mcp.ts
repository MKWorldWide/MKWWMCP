import { Server } from 'http';
import { Queue } from 'bullmq';
import { createClient } from 'redis';
import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { initDb } from '../models/store.js';
import { RepositoryService } from '../services/RepositoryService.js';
import { WebSocketService } from '../services/WebSocketService.js';
import { RoutingService } from '../services/RoutingService.js';
import { TaskOrchestrator } from '../services/TaskOrchestrator.js';
import { IntegrationService } from '../services/IntegrationService.js';
import { HeartbeatService } from '../services/HeartbeatService.js';
import { VCCService } from '../services/VCCService.js';
import { MemoryService } from '../services/MemoryService.js';
import { ResilienceService } from '../services/ResilienceService.js';
import { serviceManager } from '../services/serviceManager.js';
import { logger } from '../utils/logger.js';
import { serveSwaggerUI, serveOpenApiJson } from '../utils/swagger.js';
import { commandCenterRouter } from '../api/commandCenter.js';

type RedisClient = ReturnType<typeof createClient>;

type ServiceStatus = 'initializing' | 'online' | 'degraded' | 'offline';

interface ServiceEndpoint {
  name: string;
  url: string;
  status: ServiceStatus;
  lastPing?: Date;
  priority: number;
}

interface BotEndpoint extends ServiceEndpoint {
  type: 'bot';
  capabilities: string[];
  overridePriority?: boolean;
}

export class MasterControlProgram {
  private static instance: MasterControlProgram;
  private httpServer: Server | null = null;

  private redisClient: RedisClient | null = null;
  private taskQueue: Queue | null = null;
  private knownServices: Map<string, ServiceEndpoint> = new Map();
  private botAgents: Map<string, BotEndpoint> = new Map();
  private isInitialized = false;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  private repositoryService: RepositoryService;
  private webSocketService: WebSocketService;
  private routingService: RoutingService;
  private taskOrchestrator: TaskOrchestrator;
  private integrationService: IntegrationService;
  private heartbeatService: HeartbeatService;
  private vccService: VCCService;
  private memoryService: MemoryService;
  private resilienceService: ResilienceService;

  private constructor() {
    // Private constructor to enforce singleton
  }

  public static getInstance(): MasterControlProgram {
    if (!MasterControlProgram.instance) {
      MasterControlProgram.instance = new MasterControlProgram();
    }
    return MasterControlProgram.instance;
  }

  public async initialize(httpServer: Server, app?: Express): Promise<void> {
    if (this.isInitialized) {
      logger.warn('MCP is already initialized');
      return;
    }

    try {
      logger.info('Initializing MCP...');
      
      // Initialize database connection
      await initDb();
      
      // Initialize Redis client
      this.redisClient = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379'
      });
      
      await this.redisClient.connect();
      
      // Initialize task queue
      this.taskQueue = new Queue('mcp-tasks', {
        connection: this.redisClient as any,
        defaultJobOptions: {
          removeOnComplete: true,
          removeOnFail: 1000,
        },
      });
      
      // Initialize Express app if not provided
      const expressApp = app || express();
      
      // Configure Express middleware
      expressApp.use(cors());
      expressApp.use(express.json());
      expressApp.use(express.urlencoded({ extended: true }));
      
      // Initialize services
      await this.initializeServices(httpServer);
      
      // Register core bots and services
      await this.registerCoreBots();
      await this.registerCoreRepositories();
      await this.registerCoreServices();
      
      // Configure API routes
      this.configureApiRoutes(expressApp);
      
      // Start heartbeat monitoring
      this.startHeartbeat();
      
      // Register MCP as a service
      await this.registerMcpService();
      
      this.isInitialized = true;
      logger.info('MCP initialization complete');
    } catch (error) {
      logger.error('Failed to initialize MCP', { error });
      throw error;
    }
  }

  private async initializeServices(httpServer: any): Promise<void> {
    try {
      this.repositoryService = RepositoryService.getInstance();
      this.webSocketService = WebSocketService.getInstance();
      this.routingService = RoutingService.getInstance();
      this.taskOrchestrator = TaskOrchestrator.getInstance();
      this.integrationService = IntegrationService.getInstance();
      this.heartbeatService = HeartbeatService.getInstance();
      this.vccService = VCCService.getInstance();
      this.memoryService = MemoryService.getInstance();
      this.resilienceService = ResilienceService.getInstance();
      
      // Initialize WebSocket service
      await this.webSocketService.initialize(httpServer);
      
      // Initialize repository service
      await this.repositoryService.initialize();
      
      // Initialize routing service
      await this.routingService.initialize();
      
      // Initialize task orchestrator
      await this.taskOrchestrator.initialize();
      
      // Initialize integration service
      await this.integrationService.initialize();
      
      // Initialize heartbeat service
      await this.heartbeatService.initialize(30000); // 30-second interval
      
      // Initialize VCC service
      await this.vccService.initialize();
      
      // Initialize Memory service
      await this.memoryService.initialize();
      
      // Initialize Resilience service
      await this.resilienceService.initialize();
      
      // Register core repositories
      await this.registerCoreRepositories();
      
      // Register core bots
      this.registerCoreBots();
    } catch (error) {
      logger.error('Failed to initialize MCP services:', error);
      throw error;
    }
  }
  
  private registerCoreBots(): void {
    // Register Lilybear - Emotional Interface & Communication
    this.routingService.registerBot({
      id: 'lilybear',
      name: 'Lilybear',
      capabilities: [
        'communication',
        'emotional_interface',
        'discord_communication',
        'relay'
      ]
    });
    
    // Register Athena - Logic & Planning
    this.routingService.registerBot({
      id: 'athena',
      name: 'Athena',
      capabilities: [
        'planning',
        'logic_override',
        'observational_intelligence',
        'sentinel'
      ]
    });
    
    // Register Serafina - VRChat Integration
    this.routingService.registerBot({
      id: 'serafina',
      name: 'Serafina',
      capabilities: [
        'vrchat_integration',
        'world_management',
        'avatar_management'
      ]
    });
    
    // Register Shadow-Nexus - Security & Monitoring
    this.routingService.registerBot({
      id: 'shadow-nexus',
      name: 'Shadow-Nexus',
      capabilities: [
        'security_monitoring',
        'threat_detection',
        'access_control'
      ]
    });
    
    logger.info('Registered core bots with routing service');
  }

  private async registerCoreRepositories(): Promise<void> {
    try {
      // Define core repositories
      const coreRepos = [
        {
          name: 'MKWW-Core',
          url: 'https://github.com/MKWorldWide/MKWW-Core.git',
          branch: 'main'
        },
        {
          name: 'Lilybear',
          url: 'https://github.com/MKWorldWide/Lilybear.git',
          branch: 'main'
        },
        {
          name: 'AthenaCore',
          url: 'https://github.com/MKWorldWide/AthenaCore.git',
          branch: 'main'
        },
        {
          name: 'Serafina',
          url: 'https://github.com/MKWorldWide/Serafina.git',
          branch: 'main'
        },
        {
          name: 'Shadow-Nexus',
          url: 'https://github.com/MKWorldWide/Shadow-Nexus.git',
          branch: 'main'
        },
        {
          name: 'GameDinVR',
          url: 'https://github.com/MKWorldWide/GameDinVR.git',
          branch: 'main'
        },
        {
          name: 'CursorKitten',
          url: 'https://github.com/MKWorldWide/CursorKitten.git',
          branch: 'main'
        }
      ];

      // Register each repository
      for (const repo of coreRepos) {
        try {
          await this.repositoryService.addRepository(repo.url, repo.branch);
          logger.info(`Registered core repository: ${repo.name}`);
        } catch (error) {
          logger.error(`Failed to register repository ${repo.name}:`, error);
        }
      }

      // Initial scan of all repositories
      await this.repositoryService.scanAllRepositories();
    } catch (error) {
      logger.error('Error registering core repositories:', error);
      throw error;
    }
  }

  private async registerCoreServices(): Promise<void> {
    // Register core bots
    const coreBots: BotEndpoint[] = [
      {
        name: 'Lilybear',
        url: process.env.LILYBEAR_WS_URL || 'ws://localhost:3001',
        status: 'initializing',
        priority: 1,
        type: 'bot',
        capabilities: ['communication', 'emotional_interface'],
        overridePriority: true
      },
      {
        name: 'Athena',
        url: process.env.ATHENA_WS_URL || 'ws://localhost:3002',
        status: 'initializing',
        priority: 1,
        type: 'bot',
        capabilities: ['planning', 'logic_override']
      },
      {
        name: 'Serafina',
        url: process.env.SERAFINA_WS_URL || 'ws://localhost:3003',
        status: 'initializing',
        priority: 2,
        type: 'service',
        capabilities: ['relay', 'discord_communication']
      },
      {
        name: 'Shadow-Nexus',
        url: process.env.SHADOW_NEXUS_WS_URL || 'ws://localhost:3004',
        status: 'initializing',
        priority: 2,
        type: 'service',
        capabilities: ['observational_intelligence', 'sentinel']
      }
    ];

    for (const bot of coreBots) {
      await this.registerBot(bot);
    }
  }

  private async registerBot(bot: BotEndpoint): Promise<void> {
    this.botAgents.set(bot.name, bot);
    logger.info(`Registered bot: ${bot.name}`);
    // TODO: Establish WebSocket connection and handle reconnection logic
  }

  // WebSocket handling moved to WebSocketService

  private handleIncomingMessage(serviceName: string, message: string): void {
    try {
      const { type, data } = JSON.parse(message);
      
      switch (type) {
        case 'heartbeat':
          this.handleHeartbeat(serviceName, data);
          break;
        case 'task_update':
          this.handleTaskUpdate(serviceName, data);
          break;
        // Add other message types
      }
    } catch (error) {
      logger.error(`Error processing message from ${serviceName}:`, error);
    }
  }

  private handleHeartbeat(serviceName: string, data: any): void {
    const service = this.knownServices.get(serviceName) || this.botAgents.get(serviceName);
    if (service) {
      service.lastPing = new Date();
      service.status = 'online';
      logger.debug(`Heartbeat from ${serviceName}`);
    }
  }

  private handleTaskUpdate(serviceName: string, data: any): void {
    // Handle task updates from services
    logger.info(`Task update from ${serviceName}:`, data);
  }

  private updateServiceStatus(serviceName: string, status: ServiceStatus): void {
    const service = this.knownServices.get(serviceName) || this.botAgents.get(serviceName);
    if (service) {
      service.status = status;
      logger.info(`Service ${serviceName} status updated to ${status}`);
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.checkServiceHealth();
    }, 300000); // 5 minutes
  }

  private async checkServiceHealth(): Promise<void> {
    const now = new Date();
    const offlineThreshold = 300000; // 5 minutes

    const checkService = (service: ServiceEndpoint) => {
      if (service.lastPing && now.getTime() - service.lastPing.getTime() > offlineThreshold) {
        service.status = 'offline';
        logger.warn(`Service ${service.name} is not responding`);
      } else if (service.status === 'offline') {
        service.status = 'online';
        logger.info(`Service ${service.name} is back online`);
      }
    };

    this.knownServices.forEach(checkService);
    this.botAgents.forEach(checkService);
  }

  public async shutdown(): Promise<void> {
    logger.info('Shutting down MCP...');
    
    // Stop the heartbeat
    this.stopHeartbeat();
    
    // Shutdown services in reverse order of initialization
    await this.resilienceService.shutdown();
    await this.memoryService.shutdown();
    await this.vccService.shutdown();
    await this.heartbeatService.shutdown();
    await this.integrationService.shutdown();
    await this.taskOrchestrator.shutdown();
    await this.routingService.shutdown();
    await this.webSocketService.shutdown();
    await this.repositoryService.shutdown();
    
    // Close Redis connection if it exists
    if (this.redisClient) {
      await this.redisClient.quit();
    }
    
    // Close task queue if it exists
    if (this.taskQueue) {
      await this.taskQueue.close();
    }
    
    logger.info('MCP shutdown complete');
  }

  // Public API methods will be added here
  public async routeTask(task: any): Promise<void> {
    // TODO: Implement task routing logic
    logger.debug('Routing task:', task);
  }

  public getStatus(): { services: ServiceEndpoint[]; bots: BotEndpoint[] } {
    return {
      services: Array.from(this.knownServices.values()),
      bots: Array.from(this.botAgents.values())
    };
  }

  private configureApiRoutes(app: Express): void {
    // Mount Command Center API
    app.use('/api/mcp', commandCenterRouter);
    
    // API Documentation
    app.get('/api-docs', ...serveSwaggerUI());
    app.get('/api-docs.json', serveOpenApiJson);
    
    // Health check endpoint
    app.get('/health', (req: Request, res: Response) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version,
        environment: process.env.NODE_ENV || 'development',
      });
    });
    
    // Add integration service routes
    app.use('/api/integrations', this.integrationService.getRouter());
    
    // Add more routes as needed
  }
}

export const mcp = MasterControlProgram.getInstance();
