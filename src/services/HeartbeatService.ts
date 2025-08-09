import { logger } from '../utils/logger.js';
import { WebSocketService } from './WebSocketService.js';
import { RepositoryService } from './RepositoryService.js';
import { RoutingService } from './RoutingService.js';
import { TaskOrchestrator } from './TaskOrchestrator.js';
import { IntegrationService } from './IntegrationService.js';

export interface SystemMetrics {
  timestamp: Date;
  cpu: {
    usage: number;
    load: number[];
  };
  memory: {
    total: number;
    used: number;
    free: number;
    processUsage: number;
  };
  network: {
    bytesIn: number;
    bytesOut: number;
  };
  tasks: {
    active: number;
    completed: number;
    failed: number;
    pending: number;
  };
  integrations: Record<string, {
    status: string;
    lastSync?: Date;
    error?: string;
  }>;
  repositories: Array<{
    name: string;
    branch: string;
    lastCommit: string;
    lastSync: Date;
  }>;
}

export class HeartbeatService {
  private static instance: HeartbeatService;
  private webSocketService: WebSocketService;
  private repositoryService: RepositoryService;
  private routingService: RoutingService;
  private taskOrchestrator: TaskOrchestrator;
  private integrationService: IntegrationService;
  private intervalId: NodeJS.Timeout | null = null;
  private metricsHistory: SystemMetrics[] = [];
  private readonly MAX_METRICS_HISTORY = 1000; // Keep last 1000 metrics
  private lastNetworkStats = {
    bytesIn: 0,
    bytesOut: 0,
    timestamp: Date.now()
  };

  private constructor() {
    this.webSocketService = WebSocketService.getInstance();
    this.repositoryService = RepositoryService.getInstance();
    this.routingService = RoutingService.getInstance();
    this.taskOrchestrator = TaskOrchestrator.getInstance();
    this.integrationService = IntegrationService.getInstance();
  }

  public static getInstance(): HeartbeatService {
    if (!HeartbeatService.instance) {
      HeartbeatService.instance = new HeartbeatService();
    }
    return HeartbeatService.instance;
  }

  public async initialize(intervalMs: number = 60000): Promise<void> {
    logger.info(`Initializing Heartbeat Service with ${intervalMs}ms interval`);
    
    // Start the heartbeat interval
    this.intervalId = setInterval(() => this.collectAndBroadcastMetrics(), intervalMs);
    
    // Initial metrics collection
    await this.collectAndBroadcastMetrics();
    
    logger.info('Heartbeat Service initialized');
  }

  public async shutdown(): Promise<void> {
    logger.info('Shutting down Heartbeat Service...');
    
    // Clear the interval
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    logger.info('Heartbeat Service shutdown complete');
  }

  private async collectAndBroadcastMetrics(): Promise<void> {
    try {
      const metrics = await this.collectSystemMetrics();
      this.metricsHistory.push(metrics);
      
      // Trim history if needed
      if (this.metricsHistory.length > this.MAX_METRICS_HISTORY) {
        this.metricsHistory = this.metricsHistory.slice(-this.MAX_METRICS_HISTORY);
      }
      
      // Broadcast metrics to connected WebSocket clients
      this.webSocketService.broadcast('system_metrics', JSON.stringify(metrics));
      
      logger.debug('Collected and broadcast system metrics');
    } catch (error) {
      logger.error('Failed to collect system metrics:', error);
    }
  }

  private async collectSystemMetrics(): Promise<SystemMetrics> {
    const timestamp = new Date();
    
    // Get CPU and memory usage
    const cpuUsage = await this.getCpuUsage();
    const memoryUsage = this.getMemoryUsage();
    const networkStats = await this.getNetworkStats();
    
    // Get task metrics
    const taskMetrics = await this.getTaskMetrics();
    
    // Get integration statuses
    const integrationStatuses = await this.getIntegrationStatuses();
    
    // Get repository statuses
    const repositoryStatuses = await this.getRepositoryStatuses();
    
    return {
      timestamp,
      cpu: {
        usage: cpuUsage.usage,
        load: cpuUsage.load
      },
      memory: {
        total: memoryUsage.total,
        used: memoryUsage.used,
        free: memoryUsage.free,
        processUsage: memoryUsage.processUsage
      },
      network: {
        bytesIn: networkStats.bytesIn,
        bytesOut: networkStats.bytesOut
      },
      tasks: taskMetrics,
      integrations: integrationStatuses,
      repositories: repositoryStatuses
    };
  }

  private async getCpuUsage(): Promise<{ usage: number; load: number[] }> {
    try {
      // This is a simplified implementation
      // In a real application, you would use a library like 'os-utils' or 'systeminformation'
      const startUsage = process.cpuUsage();
      const startTime = process.hrtime();
      
      // Wait a bit to measure CPU usage
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const endUsage = process.cpuUsage(startUsage);
      const endTime = process.hrtime(startTime);
      
      // Calculate CPU usage percentage
      const totalUsage = (endUsage.user + endUsage.system) / 1000; // Convert to microseconds
      const totalTime = endTime[0] * 1000000 + endTime[1] / 1000; // Convert to microseconds
      const usage = (totalUsage / totalTime) * 100;
      
      // Get system load (1, 5, 15 minutes)
      const load = require('os').loadavg();
      
      return { usage, load };
    } catch (error) {
      logger.error('Failed to get CPU usage:', error);
      return { usage: 0, load: [0, 0, 0] };
    }
  }

  private getMemoryUsage() {
    try {
      const os = require('os');
      const total = os.totalmem();
      const free = os.freemem();
      const used = total - free;
      
      const processMemory = process.memoryUsage();
      const processUsage = processMemory.heapUsed / 1024 / 1024; // Convert to MB
      
      return {
        total: total / (1024 * 1024), // Convert to MB
        used: used / (1024 * 1024),   // Convert to MB
        free: free / (1024 * 1024),   // Convert to MB
        processUsage
      };
    } catch (error) {
      logger.error('Failed to get memory usage:', error);
      return { total: 0, used: 0, free: 0, processUsage: 0 };
    }
  }

  private async getNetworkStats() {
    try {
      // This is a simplified implementation
      // In a real application, you would use a library like 'systeminformation'
      const now = Date.now();
      const timeDiff = now - this.lastNetworkStats.timestamp;
      
      // Simulate network traffic (replace with actual implementation)
      const bytesIn = Math.floor(Math.random() * 10000);
      const bytesOut = Math.floor(Math.random() * 5000);
      
      // Calculate bytes per second
      const bytesInPerSec = (bytesIn - this.lastNetworkStats.bytesIn) / (timeDiff / 1000);
      const bytesOutPerSec = (bytesOut - this.lastNetworkStats.bytesOut) / (timeDiff / 1000);
      
      // Update last stats
      this.lastNetworkStats = {
        bytesIn,
        bytesOut,
        timestamp: now
      };
      
      return {
        bytesIn: Math.max(0, bytesInPerSec),
        bytesOut: Math.max(0, bytesOutPerSec)
      };
    } catch (error) {
      logger.error('Failed to get network stats:', error);
      return { bytesIn: 0, bytesOut: 0 };
    }
  }

  private async getTaskMetrics() {
    try {
      // Get task metrics from TaskOrchestrator
      // This assumes TaskOrchestrator has methods to get these metrics
      return {
        active: 0, // Replace with actual implementation
        completed: 0, // Replace with actual implementation
        failed: 0, // Replace with actual implementation
        pending: 0 // Replace with actual implementation
      };
    } catch (error) {
      logger.error('Failed to get task metrics:', error);
      return { active: 0, completed: 0, failed: 0, pending: 0 };
    }
  }

  private async getIntegrationStatuses() {
    try {
      // Get integration statuses from IntegrationService
      // This is a placeholder - implement actual integration status retrieval
      return {};
    } catch (error) {
      logger.error('Failed to get integration statuses:', error);
      return {};
    }
  }

  private async getRepositoryStatuses() {
    try {
      // Get repository statuses from RepositoryService
      // This is a placeholder - implement actual repository status retrieval
      return [];
    } catch (error) {
      logger.error('Failed to get repository statuses:', error);
      return [];
    }
  }

  public getMetricsHistory(limit: number = 100): SystemMetrics[] {
    return this.metricsHistory.slice(-limit);
  }

  public getLatestMetrics(): SystemMetrics | null {
    if (this.metricsHistory.length === 0) {
      return null;
    }
    const latest = this.metricsHistory[this.metricsHistory.length - 1];
    if (!latest) {
      return null;
    }
    return latest;
  }
}

export const heartbeatService = HeartbeatService.getInstance();
