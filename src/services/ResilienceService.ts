import { logger } from '../utils/logger.js';
import { WebSocketService } from './WebSocketService.js';
import { TaskOrchestrator } from './TaskOrchestrator.js';
import { RoutingService } from './RoutingService.js';
import { HeartbeatService } from './HeartbeatService.js';
import { MemoryService } from './MemoryService.js';
import { VCCService } from './VCCService.js';
import { IntegrationService } from './IntegrationService.js';

type ServiceStatus = {
  name: string;
  isHealthy: boolean;
  lastCheck: Date;
  error?: string;
  metrics?: Record<string, any>;
};

type RecoveryAction = {
  type: 'restart' | 'failover' | 'degrade' | 'notify';
  target: string;
  priority: number;
  condition: (status: ServiceStatus) => boolean;
  action: () => Promise<boolean>;
  cooldownMs: number;
  lastTriggered?: Date;
};

type CircuitBreakerState = {
  isOpen: boolean;
  failureCount: number;
  lastFailureTime: Date | null;
  successCount: number;
  lastSuccessTime: Date | null;
};

export class ResilienceService {
  private static instance: ResilienceService;
  private webSocketService: WebSocketService;
  private taskOrchestrator: TaskOrchestrator;
  private routingService: RoutingService;
  private heartbeatService: HeartbeatService;
  private memoryService: MemoryService;
  private vccService: VCCService;
  private integrationService: IntegrationService;
  
  private serviceStatus: Map<string, ServiceStatus> = new Map();
  private recoveryActions: RecoveryAction[] = [];
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  private isMonitoring: boolean = false;
  private monitorInterval: NodeJS.Timeout | null = null;
  
  // Configuration
  private readonly MONITOR_INTERVAL_MS = 30000; // 30 seconds
  private readonly CIRCUIT_BREAKER_THRESHOLD = 5; // Number of failures before opening the circuit
  private readonly CIRCUIT_BREAKER_RESET_MS = 300000; // 5 minutes
  
  private constructor() {
    this.webSocketService = WebSocketService.getInstance();
    this.taskOrchestrator = TaskOrchestrator.getInstance();
    this.routingService = RoutingService.getInstance();
    this.heartbeatService = HeartbeatService.getInstance();
    this.memoryService = MemoryService.getInstance();
    this.vccService = VCCService.getInstance();
    this.integrationService = IntegrationService.getInstance();
    
    // Initialize service status
    this.initializeServiceStatus();
    
    // Set up recovery actions
    this.initializeRecoveryActions();
    
    // Set up WebSocket message handlers
    this.setupWebSocketHandlers();
  }
  
  public static getInstance(): ResilienceService {
    if (!ResilienceService.instance) {
      ResilienceService.instance = new ResilienceService();
    }
    return ResilienceService.instance;
  }
  
  public async initialize(): Promise<void> {
    logger.info('Initializing Resilience Service');
    
    // Start monitoring
    this.startMonitoring();
    
    logger.info('Resilience Service initialized');
  }
  
  public async shutdown(): Promise<void> {
    logger.info('Shutting down Resilience Service...');
    
    // Stop monitoring
    this.stopMonitoring();
    
    logger.info('Resilience Service shutdown complete');
  }
  
  private initializeServiceStatus(): void {
    // Initialize status for core services
    this.serviceStatus.set('websocket', {
      name: 'WebSocket Service',
      isHealthy: true,
      lastCheck: new Date()
    });
    
    this.serviceStatus.set('taskOrchestrator', {
      name: 'Task Orchestrator',
      isHealthy: true,
      lastCheck: new Date()
    });
    
    this.serviceStatus.set('routing', {
      name: 'Routing Service',
      isHealthy: true,
      lastCheck: new Date()
    });
    
    this.serviceStatus.set('heartbeat', {
      name: 'Heartbeat Service',
      isHealthy: true,
      lastCheck: new Date()
    });
    
    this.serviceStatus.set('memory', {
      name: 'Memory Service',
      isHealthy: true,
      lastCheck: new Date()
    });
    
    this.serviceStatus.set('vcc', {
      name: 'VCC Service',
      isHealthy: true,
      lastCheck: new Date()
    });
    
    this.serviceStatus.set('integration', {
      name: 'Integration Service',
      isHealthy: true,
      lastCheck: new Date()
    });
  }
  
  private initializeRecoveryActions(): void {
    // WebSocket Service recovery actions
    this.recoveryActions.push({
      type: 'restart',
      target: 'websocket',
      priority: 1, // Highest priority
      condition: (status) => !status.isHealthy,
      action: async () => {
        logger.warn('Attempting to restart WebSocket Service...');
        try {
          await this.webSocketService.shutdown();
          // In a real implementation, we would have a way to restart the WebSocket server
          // For now, we'll just simulate a successful restart
          return true;
        } catch (error) {
          logger.error('Failed to restart WebSocket Service:', error);
          return false;
        }
      },
      cooldownMs: 60000 // 1 minute cooldown
    });
    
    // Task Orchestrator recovery actions
    this.recoveryActions.push({
      type: 'restart',
      target: 'taskOrchestrator',
      priority: 2,
      condition: (status) => !status.isHealthy,
      action: async () => {
        logger.warn('Attempting to restart Task Orchestrator...');
        try {
          await this.taskOrchestrator.shutdown();
          await this.taskOrchestrator.initialize();
          return true;
        } catch (error) {
          logger.error('Failed to restart Task Orchestrator:', error);
          return false;
        }
      },
      cooldownMs: 60000
    });
    
    // Integration Service recovery actions
    this.recoveryActions.push({
      type: 'restart',
      target: 'integration',
      priority: 3,
      condition: (status) => !status.isHealthy,
      action: async () => {
        logger.warn('Attempting to restart Integration Service...');
        try {
          await this.integrationService.shutdown();
          await this.integrationService.initialize();
          return true;
        } catch (error) {
          logger.error('Failed to restart Integration Service:', error);
          return false;
        }
      },
      cooldownMs: 120000 // 2 minute cooldown
    });
    
    // Add more recovery actions as needed...
  }
  
  private setupWebSocketHandlers(): void {
    // Handle health check requests
    this.webSocketService.onMessage('health:check', async (data: any, clientId: string) => {
      const status = this.getSystemStatus();
      this.webSocketService.sendToClient(clientId, 'health:status', status);
    });
    
    // Handle manual service restart requests
    this.webSocketService.onMessage('service:restart', async (data: any) => {
      const { service } = data;
      if (!service) return;
      
      logger.info(`Manual restart requested for service: ${service}`);
      
      // Find and execute matching recovery actions
      const actions = this.recoveryActions
        .filter(action => action.target === service)
        .sort((a, b) => a.priority - b.priority);
      
      for (const action of actions) {
        try {
          const success = await action.action();
          if (success) {
            this.webSocketService.broadcast('service:restarted', { service, success: true });
            return;
          }
        } catch (error) {
          logger.error(`Failed to execute recovery action for ${service}:`, error);
        }
      }
      
      this.webSocketService.broadcast('service:restart_failed', { service });
    });
  }
  
  private startMonitoring(): void {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    
    // Initial check
    this.checkServices();
    
    // Set up periodic checks
    this.monitorInterval = setInterval(
      () => this.checkServices(),
      this.MONITOR_INTERVAL_MS
    );
    
    logger.info('Started service monitoring');
  }
  
  private stopMonitoring(): void {
    if (!this.isMonitoring) return;
    
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    
    this.isMonitoring = false;
    logger.info('Stopped service monitoring');
  }
  
  private async checkServices(): Promise<void> {
    const checkPromises: Promise<void>[] = [];
    
    // Check WebSocket Service
    checkPromises.push(
      this.checkService('websocket', async () => {
        // Simple ping test
        return this.webSocketService.isConnected();
      })
    );
    
    // Check Task Orchestrator
    checkPromises.push(
      this.checkService('taskOrchestrator', async () => {
        // Check if task queue is processing
        return true; // Simplified for this example
      })
    );
    
    // Check Routing Service
    checkPromises.push(
      this.checkService('routing', async () => {
        // Check if routing service has available bots
        return true; // Simplified for this example
      })
    );
    
    // Check Heartbeat Service
    checkPromises.push(
      this.checkService('heartbeat', async () => {
        // Check if heartbeats are being processed
        return true; // Simplified for this example
      })
    );
    
    // Check Memory Service
    checkPromises.push(
      this.checkService('memory', async () => {
        // Try a simple operation
        try {
          await this.memoryService.getMessages('health-check', 1);
          return true;
        } catch (error) {
          return false;
        }
      })
    );
    
    // Check VCC Service
    checkPromises.push(
      this.checkService('vcc', async () => {
        // Check if VCC is responding
        return true; // Simplified for this example
      })
    );
    
    // Check Integration Service
    checkPromises.push(
      this.checkService('integration', async () => {
        // Check if integrations are responding
        return true; // Simplified for this example
      })
    );
    
    // Wait for all checks to complete
    await Promise.all(checkPromises);
    
    // Trigger recovery actions for unhealthy services
    await this.triggerRecoveryActions();
    
    // Broadcast system status
    this.broadcastSystemStatus();
  }
  
  private async checkService(serviceId: string, checkFn: () => Promise<boolean>): Promise<void> {
    const status = this.serviceStatus.get(serviceId);
    if (!status) return;
    
    try {
      const isHealthy = await checkFn();
      const wasHealthy = status.isHealthy;
      
      // Update status
      status.isHealthy = isHealthy;
      status.lastCheck = new Date();
      
      // Log state changes
      if (wasHealthy !== isHealthy) {
        if (isHealthy) {
          logger.info(`Service ${status.name} is now healthy`);
          this.recordCircuitBreakerEvent(serviceId, true);
        } else {
          logger.warn(`Service ${status.name} is unhealthy`);
          this.recordCircuitBreakerEvent(serviceId, false);
        }
      }
      
      // Update metrics
      status.metrics = {
        ...status.metrics,
        lastCheck: status.lastCheck.toISOString(),
        uptime: this.getServiceUptime(serviceId)
      };
      
    } catch (error) {
      logger.error(`Error checking service ${serviceId}:`, error);
      status.isHealthy = false;
      status.lastCheck = new Date();
      status.error = error instanceof Error ? error.message : 'Unknown error';
      this.recordCircuitBreakerEvent(serviceId, false);
    }
  }
  
  private getServiceUptime(serviceId: string): string {
    // Simplified uptime calculation
    // In a real implementation, you would track when the service was last started
    return '24h'; // Placeholder
  }
  
  private recordCircuitBreakerEvent(serviceId: string, isSuccess: boolean): void {
    let circuit = this.circuitBreakers.get(serviceId) || {
      isOpen: false,
      failureCount: 0,
      lastFailureTime: null,
      successCount: 0,
      lastSuccessTime: null
    };
    
    if (isSuccess) {
      circuit.successCount++;
      circuit.lastSuccessTime = new Date();
      
      // Reset failure count on consecutive successes
      if (circuit.successCount >= this.CIRCUIT_BREAKER_THRESHOLD) {
        circuit.failureCount = 0;
      }
      
      // Close circuit if it was open
      if (circuit.isOpen) {
        logger.info(`Closing circuit for service ${serviceId}`);
        circuit.isOpen = false;
      }
    } else {
      circuit.failureCount++;
      circuit.lastFailureTime = new Date();
      circuit.successCount = 0;
      
      // Open circuit if threshold is reached
      if (!circuit.isOpen && circuit.failureCount >= this.CIRCUIT_BREAKER_THRESHOLD) {
        logger.warn(`Opening circuit for service ${serviceId} (${circuit.failureCount} failures)`);
        circuit.isOpen = true;
      }
    }
    
    this.circuitBreakers.set(serviceId, circuit);
  }
  
  private async triggerRecoveryActions(): Promise<void> {
    // Get all unhealthy services
    const unhealthyServices = Array.from(this.serviceStatus.entries())
      .filter(([_, status]) => !status.isHealthy)
      .map(([id, status]) => ({ id, status }));
    
    // Process each unhealthy service
    for (const { id, status } of unhealthyServices) {
      // Get applicable recovery actions, sorted by priority
      const actions = this.recoveryActions
        .filter(action => action.target === id && action.condition(status))
        .sort((a, b) => a.priority - b.priority);
      
      // Skip if no actions available
      if (actions.length === 0) continue;
      
      // Check circuit breaker
      const circuit = this.circuitBreakers.get(id);
      if (circuit?.isOpen) {
        // Check if we should try to close the circuit
        const timeSinceFailure = circuit.lastFailureTime
          ? Date.now() - circuit.lastFailureTime.getTime()
          : Infinity;
        
        if (timeSinceFailure < this.CIRCUIT_BREAKER_RESET_MS) {
          logger.warn(`Circuit is open for service ${id}, skipping recovery actions`);
          continue;
        } else {
          // Reset circuit after cooldown
          logger.info(`Resetting circuit for service ${id}`);
          circuit.isOpen = false;
          circuit.failureCount = 0;
        }
      }
      
      // Execute recovery actions in order of priority
      for (const action of actions) {
        // Check cooldown
        const now = new Date();
        if (action.lastTriggered) {
          const timeSinceLastTrigger = now.getTime() - action.lastTriggered.getTime();
          if (timeSinceLastTrigger < action.cooldownMs) {
            logger.debug(`Skipping ${action.type} for ${id} (cooldown)`);
            continue;
          }
        }
        
        logger.info(`Executing ${action.type} for ${id}...`);
        
        try {
          const success = await action.action();
          action.lastTriggered = now;
          
          if (success) {
            logger.info(`Successfully executed ${action.type} for ${id}`);
            
            // If action was successful, move to the next service
            break;
          } else {
            logger.warn(`Failed to execute ${action.type} for ${id}`);
          }
        } catch (error) {
          logger.error(`Error executing ${action.type} for ${id}:`, error);
        }
      }
    }
  }
  
  private broadcastSystemStatus(): void {
    const status = this.getSystemStatus();
    this.webSocketService.broadcast('system:status', status);
  }
  
  public getSystemStatus() {
    const services = Array.from(this.serviceStatus.entries()).map(([id, status]) => ({
      id,
      name: status.name,
      isHealthy: status.isHealthy,
      lastCheck: status.lastCheck.toISOString(),
      error: status.error,
      metrics: status.metrics || {}
    }));
    
    // Calculate overall system health
    const unhealthyServices = services.filter(s => !s.isHealthy);
    const isSystemHealthy = unhealthyServices.length === 0;
    
    return {
      timestamp: new Date().toISOString(),
      isSystemHealthy,
      unhealthyServices: unhealthyServices.map(s => s.id),
      services: services.reduce((acc, service) => {
        acc[service.id] = service;
        return acc;
      }, {} as Record<string, any>),
      circuitBreakers: Object.fromEntries(
        Array.from(this.circuitBreakers.entries()).map(([id, cb]) => [
          id,
          {
            isOpen: cb.isOpen,
            failureCount: cb.failureCount,
            lastFailureTime: cb.lastFailureTime?.toISOString(),
            successCount: cb.successCount,
            lastSuccessTime: cb.lastSuccessTime?.toISOString()
          }
        ])
      )
    };
  }
  
  public isServiceHealthy(serviceId: string): boolean {
    const status = this.serviceStatus.get(serviceId);
    if (!status) return false;
    
    // Check circuit breaker
    const circuit = this.circuitBreakers.get(serviceId);
    if (circuit?.isOpen) {
      return false;
    }
    
    return status.isHealthy;
  }
  
  public getServiceMetrics(serviceId: string): Record<string, any> | null {
    const status = this.serviceStatus.get(serviceId);
    if (!status) return null;
    
    return {
      ...status.metrics,
      isHealthy: status.isHealthy,
      lastCheck: status.lastCheck.toISOString(),
      error: status.error
    };
  }
}

export const resilienceService = ResilienceService.getInstance();
