import { logger } from '../utils/logger.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { TaskOrchestrator } from './TaskOrchestrator.js';
import { WebSocketService } from './WebSocketService.js';

const execAsync = promisify(exec);

interface VCCProject {
  id: string;
  name: string;
  path: string;
  type: 'world' | 'avatar' | 'sdk';
  lastBuildTime?: Date;
  lastBuildStatus?: 'success' | 'failed' | 'in_progress';
  lastBuildError?: string;
  version: string;
  dependencies: Record<string, string>;
}

export class VCCService {
  private static instance: VCCService;
  private taskOrchestrator: TaskOrchestrator;
  private webSocketService: WebSocketService;
  private vccPath: string;
  private projects: Map<string, VCCProject> = new Map();
  private buildQueue: string[] = [];
  private isBuilding: boolean = false;
  private buildLogs: Map<string, string[]> = new Map();
  
  private constructor() {
    this.taskOrchestrator = TaskOrchestrator.getInstance();
    this.webSocketService = WebSocketService.getInstance();
    
    // Default VCC path - can be overridden via environment variable
    this.vccPath = process.env.VCC_PATH || 'vcc';
    
    // Set up WebSocket message handlers
    this.setupWebSocketHandlers();
  }

  public static getInstance(): VCCService {
    if (!VCCService.instance) {
      VCCService.instance = new VCCService();
    }
    return VCCService.instance;
  }

  public async initialize(): Promise<void> {
    logger.info('Initializing VCC Service');
    
    // Check if VCC is installed and accessible
    try {
      const { stdout } = await execAsync(`${this.vccPath} --version`);
      logger.info(`VCC version: ${stdout.trim()}`);
    } catch (error) {
      logger.error('Failed to initialize VCC. Make sure VCC is installed and in your PATH.');
      throw error;
    }
    
    // Scan for VCC projects
    await this.scanForProjects();
    
    // Start the build queue processor
    this.processBuildQueue();
    
    logger.info('VCC Service initialized');
  }

  public async shutdown(): Promise<void> {
    logger.info('Shutting down VCC Service...');
    // Any cleanup code here
    logger.info('VCC Service shutdown complete');
  }

  private setupWebSocketHandlers(): void {
    this.webSocketService.onMessage('vcc_build_project', async (data: any) => {
      const { projectId } = data;
      if (!projectId) {
        logger.error('Missing projectId in vcc_build_project message');
        return;
      }
      
      try {
        await this.queueProjectBuild(projectId);
        this.webSocketService.broadcast('vcc_build_queued', { projectId });
      } catch (error) {
        logger.error(`Failed to queue build for project ${projectId}:`, error);
        this.webSocketService.broadcast('vcc_build_error', {
          projectId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });
    
    this.webSocketService.onMessage('vcc_get_status', (data: any) => {
      const { projectId } = data;
      if (projectId) {
        const project = this.projects.get(projectId);
        if (project) {
          this.webSocketService.broadcast('vcc_project_status', project);
        }
      } else {
        // Send status of all projects
        this.webSocketService.broadcast('vcc_projects_status', 
          Array.from(this.projects.values())
        );
      }
    });
  }

  public async scanForProjects(basePath?: string): Promise<VCCProject[]> {
    const scanPath = basePath || process.cwd();
    logger.info(`Scanning for VCC projects in ${scanPath}`);
    
    try {
      const { stdout } = await execAsync(
        `${this.vccPath} project list --json`,
        { cwd: scanPath }
      );
      
      const projects = JSON.parse(stdout) as VCCProject[];
      
      // Update projects map
      projects.forEach(project => {
        const existingProject = this.projects.get(project.id);
        if (existingProject) {
          // Update existing project
          Object.assign(existingProject, project);
        } else {
          // Add new project
          this.projects.set(project.id, {
            ...project,
            lastBuildStatus: undefined,
            lastBuildError: undefined
          });
        }
      });
      
      logger.info(`Found ${projects.length} VCC projects`);
      return projects;
    } catch (error) {
      logger.error('Failed to scan for VCC projects:', error);
      throw error;
    }
  }

  public async queueProjectBuild(projectId: string): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }
    
    // Add to queue if not already in it
    if (!this.buildQueue.includes(projectId)) {
      this.buildQueue.push(projectId);
      logger.info(`Queued build for project ${project.name} (${projectId})`);
    } else {
      logger.info(`Project ${project.name} (${projectId}) is already in the build queue`);
    }
  }

  private async processBuildQueue(): Promise<void> {
    if (this.isBuilding || this.buildQueue.length === 0) {
      // No projects to build or already building
      setTimeout(() => this.processBuildQueue(), 1000);
      return;
    }
    
    this.isBuilding = true;
    const projectId = this.buildQueue.shift();
    
    if (!projectId) {
      this.isBuilding = false;
      setTimeout(() => this.processBuildQueue(), 1000);
      return;
    }
    
    const project = this.projects.get(projectId);
    if (!project) {
      logger.error(`Project ${projectId} not found in projects map`);
      this.isBuilding = false;
      setTimeout(() => this.processBuildQueue(), 1000);
      return;
    }
    
    logger.info(`Starting build for project ${project.name} (${projectId})`);
    
    // Update project status
    project.lastBuildStatus = 'in_progress';
    project.lastBuildError = undefined;
    this.webSocketService.broadcast('vcc_build_started', { projectId });
    
    try {
      // Execute VCC build command
      const buildCommand = `${this.vccPath} build "${project.path}"`;
      logger.debug(`Executing: ${buildCommand}`);
      
      const { stdout, stderr } = await execAsync(buildCommand, {
        cwd: project.path,
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer for build output
      });
      
      // Handle build output
      this.handleBuildOutput(projectId, stdout, stderr);
      
      // Update project status
      project.lastBuildStatus = 'success';
      project.lastBuildTime = new Date();
      
      logger.info(`Successfully built project ${project.name} (${projectId})`);
      this.webSocketService.broadcast('vcc_build_completed', {
        projectId,
        status: 'success',
        timestamp: new Date()
      });
      
      // Trigger deployment if enabled
      if (process.env.VCC_AUTO_DEPLOY === 'true') {
        await this.deployProject(projectId);
      }
    } catch (error) {
      // Handle build error
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Build failed for project ${project.name} (${projectId}):`, errorMessage);
      
      // Update project status
      project.lastBuildStatus = 'failed';
      project.lastBuildError = errorMessage;
      
      this.webSocketService.broadcast('vcc_build_failed', {
        projectId,
        error: errorMessage,
        timestamp: new Date()
      });
    } finally {
      this.isBuilding = false;
      // Process next item in queue
      setTimeout(() => this.processBuildQueue(), 1000);
    }
  }

  private handleBuildOutput(projectId: string, stdout: string, stderr: string): void {
    // Split output into lines and store in build logs
    const outputLines = [...stdout.split('\n'), ...stderr.split('\n')]
      .filter(line => line.trim().length > 0);
    
    // Store logs (keep last 1000 lines per project)
    const existingLogs = this.buildLogs.get(projectId) || [];
    const newLogs = [...existingLogs, ...outputLines].slice(-1000);
    this.buildLogs.set(projectId, newLogs);
    
    // Broadcast log updates
    this.webSocketService.broadcast('vcc_build_output', {
      projectId,
      lines: outputLines,
      timestamp: new Date()
    });
  }

  public async deployProject(projectId: string): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }
    
    if (project.lastBuildStatus !== 'success') {
      throw new Error('Cannot deploy project with failed or incomplete build');
    }
    
    logger.info(`Starting deployment for project ${project.name} (${projectId})`);
    
    try {
      // Execute VCC deploy command
      const deployCommand = `${this.vccPath} deploy "${project.path}"`;
      logger.debug(`Executing: ${deployCommand}`);
      
      const { stdout, stderr } = await execAsync(deployCommand, {
        cwd: project.path,
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer for deploy output
      });
      
      // Handle deployment output
      this.handleDeployOutput(projectId, stdout, stderr);
      
      logger.info(`Successfully deployed project ${project.name} (${projectId})`);
      this.webSocketService.broadcast('vcc_deploy_completed', {
        projectId,
        status: 'success',
        timestamp: new Date()
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Deployment failed for project ${project.name} (${projectId}):`, errorMessage);
      
      this.webSocketService.broadcast('vcc_deploy_failed', {
        projectId,
        error: errorMessage,
        timestamp: new Date()
      });
      
      throw error;
    }
  }

  private handleDeployOutput(projectId: string, stdout: string, stderr: string): void {
    // Process deployment output (similar to build output)
    const outputLines = [...stdout.split('\n'), ...stderr.split('\n')]
      .filter(line => line.trim().length > 0);
    
    // Store logs (keep last 1000 lines per project)
    const existingLogs = this.buildLogs.get(projectId) || [];
    const newLogs = [...existingLogs, ...outputLines].slice(-1000);
    this.buildLogs.set(projectId, newLogs);
    
    // Broadcast log updates
    this.webSocketService.broadcast('vcc_deploy_output', {
      projectId,
      lines: outputLines,
      timestamp: new Date()
    });
  }

  public getProject(projectId: string): VCCProject | undefined {
    return this.projects.get(projectId);
  }

  public getAllProjects(): VCCProject[] {
    return Array.from(this.projects.values());
  }

  public getBuildLogs(projectId: string, limit: number = 100): string[] {
    const logs = this.buildLogs.get(projectId) || [];
    return logs.slice(-limit);
  }
}

export const vccService = VCCService.getInstance();
