import { logger } from '../utils/logger.js';
import { RoutingService } from './RoutingService.js';
import { WebSocketService } from './WebSocketService.js';

type BotCapability = 'communication' | 'emotional_interface' | 'planning' | 'logic_override' | 'relay' | 'discord_communication' | 'observational_intelligence' | 'sentinel' | 'vrchat_integration' | 'world_management' | 'avatar_management' | 'security_monitoring' | 'threat_detection' | 'access_control';

// Types
type TaskType = 'communication' | 'planning' | 'execution' | 'monitoring' | 'analysis' | 'introspection' | 'vrchat_integration' | 'world_management' | 'avatar_management' | 'security_monitoring';
type TaskStatus = 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed';

interface TaskDependency {
  taskId: string;
  requiredStatus: TaskStatus[];
}

interface TaskMetadata {
  parentTaskId: string | null;
  depth: number;
  retryCount: number;
  maxRetries: number;
  timeoutMs: number;
  dependencies: TaskDependency[];
  createdAt: Date;
  updatedAt: Date;
}

interface Task {
  id: string;
  type: TaskType;
  status: TaskStatus;
  priority: number;
  requiredCapabilities: string[];
  data: any;
  result?: any;
  error?: string;
  metadata: TaskMetadata;
}

export class TaskOrchestrator {
  private static instance: TaskOrchestrator;
  private routingService: RoutingService;
  private webSocketService: WebSocketService;
  private activeTasks: Map<string, Task> = new Map();
  private completedTasks: Map<string, Task> = new Map();
  private introspectionInterval: NodeJS.Timeout | null = null;

  private constructor() {
    this.routingService = RoutingService.getInstance();
    this.webSocketService = WebSocketService.getInstance();
  }

  public static getInstance(): TaskOrchestrator {
    if (!TaskOrchestrator.instance) {
      TaskOrchestrator.instance = new TaskOrchestrator();
    }
    return TaskOrchestrator.instance;
  }

  public async initialize(): Promise<void> {
    logger.info('Initializing Task Orchestrator');
    
    // Register message handlers
    this.webSocketService.onMessage('task_result', this.handleTaskResult.bind(this));
    
    // Start periodic introspection
    this.scheduleIntrospection();
    
    logger.info('Task Orchestrator initialized');
  }

  private scheduleIntrospection(): void {
    // Run introspection every 5 minutes
    this.introspectionInterval = setInterval(() => {
      this.runIntrospection().catch(error => {
        logger.error('Error during introspection:', error);
      });
    }, 5 * 60 * 1000);
    
    // Initial introspection
    this.runIntrospection().catch(error => {
      logger.error('Error during initial introspection:', error);
    });
  }

  private async runIntrospection(): Promise<void> {
    logger.info('Starting system introspection...');
    
    const metrics = await this.collectSystemMetrics();
    const analysis = this.analyzeMetrics(metrics);
    
    if (analysis.requiresAction) {
      logger.warn('System introspection detected issues requiring attention:', analysis.issues);
      await this.takeRemedialActions(analysis);
    } else {
      logger.info('System introspection completed successfully');
    }
  }

  private async collectSystemMetrics(): Promise<Record<string, any>> {
    // Collect various system metrics
    return {
      timestamp: new Date().toISOString(),
      activeTasks: this.activeTasks.size,
      completedTasks: this.completedTasks.size,
      // Add more metrics as needed
    };
  }

  private analyzeMetrics(metrics: Record<string, any>): {
    requiresAction: boolean;
    issues: string[];
    recommendations: string[];
  } {
    const issues: string[] = [];
    const recommendations: string[] = [];
    
    // Example analysis
    if (metrics.activeTasks > 100) {
      issues.push('High number of active tasks detected');
      recommendations.push('Consider increasing task processing capacity');
    }
    
    // Add more analysis logic as needed
    
    return {
      requiresAction: issues.length > 0,
      issues,
      recommendations
    };
  }

  private async takeRemedialActions(analysis: {
    requiresAction: boolean;
    issues: string[];
    recommendations: string[];
  }): Promise<void> {
    if (!analysis.requiresAction) return;
    
    logger.info('Taking remedial actions based on system analysis');
    
    // Example: Log issues and recommendations
    logger.warn('System issues detected:', analysis.issues);
    logger.info('Recommended actions:', analysis.recommendations);
    
    // Implement specific remedial actions based on issues
    for (const issue of analysis.issues) {
      // Add specific actions for each type of issue
      logger.info(`Addressing issue: ${issue}`);
      // Implement actual remediation logic here
    }
  }

  private async handleTaskResult(connectionId: string, data: any): Promise<void> {
    const { taskId, result, error } = data;
    
    const task = this.activeTasks.get(taskId);
    if (!task) {
      logger.warn(`Received result for unknown task: ${taskId}`);
      return;
    }
    
    // Update task status
    task.status = error ? 'failed' : 'completed';
    task.result = result;
    if (error) {
      task.error = error;
    }
    
    // Move to completed tasks
    this.activeTasks.delete(taskId);
    this.completedTasks.set(taskId, task);
    
    logger.info(`Task ${taskId} ${error ? 'failed' : 'completed'}`);
    
    // Trigger any dependent tasks or workflows
    await this.handleTaskCompletion(task);
  }

  private async handleTaskCompletion(task: Task): Promise<void> {
    // Implement task completion logic here
    // This could include triggering dependent tasks, updating workflows, etc.
    logger.debug(`Handling completion of task ${task.id} (${task.type})`);
  }

  public async createTask(
    type: TaskType,
    data: any,
    options: {
      priority?: number;
      requiredCapabilities?: BotCapability[];
      parentTaskId?: string | null;
      maxRetries?: number;
      timeoutMs?: number;
    } = {}
  ): Promise<string> {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const task: Task = {
      id: taskId,
      type,
      status: 'pending',
      priority: options.priority || 5,
      requiredCapabilities: options.requiredCapabilities || [],
      data,
      metadata: {
        parentTaskId: options.parentTaskId || null,
        depth: options.parentTaskId ? 
          (this.activeTasks.get(options.parentTaskId)?.metadata.depth || 0) + 1 : 0,
        retryCount: 0,
        maxRetries: options.maxRetries || 3,
        timeoutMs: options.timeoutMs || 300000, // 5 minutes default
        dependencies: [],
        createdAt: new Date(),
        updatedAt: new Date()
      } as TaskMetadata
    };
    
    this.activeTasks.set(taskId, task);
    
    // Queue the task for execution
    await this.queueTask(task);
    
    return taskId;
  }

  private async queueTask(task: Task): Promise<void> {
    try {
      // Use the routing service to assign the task to an appropriate bot
      await this.routingService.submitTask({
        type: task.type as any, // Type assertion since TaskType is more specific
        priority: task.priority,
        requiredCapabilities: task.requiredCapabilities,
        data: task.data
      });
      
      task.status = 'assigned';
      task.metadata.updatedAt = new Date();
      
      logger.info(`Task ${task.id} queued for execution`);
    } catch (error) {
      logger.error(`Failed to queue task ${task.id}:`, error);
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : 'Unknown error';
      task.metadata.updatedAt = new Date();
      
      // Move to completed tasks
      this.activeTasks.delete(task.id);
      this.completedTasks.set(task.id, task);
    }
  }

  public async getTaskStatus(taskId: string): Promise<Task | undefined> {
    return this.activeTasks.get(taskId) || this.completedTasks.get(taskId);
  }

  public async shutdown(): Promise<void> {
    // Clean up resources
    if (this.introspectionInterval) {
      clearInterval(this.introspectionInterval);
      this.introspectionInterval = null;
    }
    
    // Remove message handlers
    this.webSocketService.offMessage('task_result');
    
    logger.info('Task Orchestrator shutdown');
  }
}

export const taskOrchestrator = TaskOrchestrator.getInstance();
