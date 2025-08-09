import { logger } from '../utils/logger.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ServiceStatus {
  id: string;
  name: string;
  status: 'running' | 'stopped' | 'error' | 'restarting';
  uptime?: number; // in seconds
  cpuUsage?: number; // percentage
  memoryUsage?: number; // in MB
  lastError?: string;
  lastRestart?: Date;
  version?: string;
}

interface ServiceConfig {
  id: string;
  name: string;
  command: string;
  autoRestart?: boolean;
  maxRestarts?: number;
  workingDir?: string;
  env?: Record<string, string>;
}

class ServiceManager {
  private static instance: ServiceManager;
  private services: Map<string, ServiceConfig> = new Map();
  private statuses: Map<string, ServiceStatus> = new Map();
  private processes: Map<string, any> = new Map();
  private restartCounts: Map<string, number> = new Map();

  private constructor() {
    // Initialize with default services
    this.initializeDefaultServices();
  }

  public static getInstance(): ServiceManager {
    if (!ServiceManager.instance) {
      ServiceManager.instance = new ServiceManager();
    }
    return ServiceManager.instance;
  }

  private initializeDefaultServices() {
    // Add default services here
    this.addService({
      id: 'api',
      name: 'MCP API Server',
      command: 'node dist/server.js',
      autoRestart: true,
      maxRestarts: 5,
      workingDir: process.cwd(),
      env: {
        NODE_ENV: process.env.NODE_ENV || 'development',
        PORT: process.env.PORT || '3000',
      },
    });

    // Add more default services as needed
  }

  public addService(config: ServiceConfig): void {
    this.services.set(config.id, {
      ...config,
      autoRestart: config.autoRestart ?? true,
      maxRestarts: config.maxRestarts ?? 5,
    });

    this.statuses.set(config.id, {
      id: config.id,
      name: config.name,
      status: 'stopped',
      version: process.env.npm_package_version,
    });
  }

  public async getServiceStatus(serviceId: string): Promise<ServiceStatus | null> {
    const status = this.statuses.get(serviceId);
    if (!status) return null;

    // In a real implementation, this would check the actual service status
    // For now, we'll just return the cached status
    return status;
  }

  public async listServices(): Promise<ServiceStatus[]> {
    const services: ServiceStatus[] = [];
    
    for (const [id, config] of this.services.entries()) {
      const status = await this.getServiceStatus(id);
      if (status) {
        services.push(status);
      }
    }
    
    return services;
  }

  public async restartService(
    serviceId: string, 
    options: { force?: boolean; timeout?: number } = {}
  ): Promise<{ success: boolean; status?: ServiceStatus; error?: string }> {
    const config = this.services.get(serviceId);
    if (!config) {
      return { success: false, error: 'Service not found' };
    }

    const currentStatus = this.statuses.get(serviceId);
    if (!currentStatus) {
      return { success: false, error: 'Service status not available' };
    }

    // Check if service is already restarting
    if (currentStatus.status === 'restarting' && !options.force) {
      return { 
        success: false, 
        error: 'Service is already restarting',
        status: currentStatus
      };
    }

    // Update status to restarting
    const updatedStatus: ServiceStatus = {
      ...currentStatus,
      status: 'restarting',
      lastRestart: new Date(),
    };
    this.statuses.set(serviceId, updatedStatus);

    try {
      // Stop the service if it's running
      await this.stopService(serviceId);
      
      // Start the service
      await this.startService(serviceId, options.timeout);
      
      // Get the updated status
      const newStatus = await this.getServiceStatus(serviceId);
      
      if (newStatus?.status === 'running') {
        logger.info(`Service ${serviceId} restarted successfully`);
        return { success: true, status: newStatus };
      } else {
        throw new Error('Service failed to start after restart');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to restart service ${serviceId}`, { error: errorMessage });
      
      // Update status with error
      this.statuses.set(serviceId, {
        ...updatedStatus,
        status: 'error',
        lastError: errorMessage,
      });
      
      return { 
        success: false, 
        error: errorMessage,
        status: this.statuses.get(serviceId),
      };
    }
  }

  private async startService(serviceId: string, timeoutMs: number = 5000): Promise<void> {
    const config = this.services.get(serviceId);
    if (!config) throw new Error('Service not found');

    // In a real implementation, this would start the service process
    // For now, we'll just simulate it
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        const status = this.statuses.get(serviceId);
        if (status) {
          status.status = 'running';
          status.lastError = undefined;
          this.statuses.set(serviceId, status);
          resolve();
        } else {
          reject(new Error('Service status not found'));
        }
      }, 1000); // Simulate service start time
    });
  }

  private async stopService(serviceId: string): Promise<void> {
    const status = this.statuses.get(serviceId);
    if (!status) throw new Error('Service not found');

    // In a real implementation, this would stop the service process
    // For now, we'll just simulate it
    return new Promise((resolve) => {
      setTimeout(() => {
        status.status = 'stopped';
        this.statuses.set(serviceId, status);
        resolve();
      }, 500); // Simulate service stop time
    });
  }

  // Additional service management methods can be added here
}

export const serviceManager = ServiceManager.getInstance();

export default ServiceManager;
