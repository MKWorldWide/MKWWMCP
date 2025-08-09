import { logger } from '../utils/logger.js';
import { WebSocketService } from './WebSocketService.js';

type BotCapability = 'communication' | 'emotional_interface' | 'planning' | 'logic_override' | 'relay' | 'discord_communication' | 'observational_intelligence' | 'sentinel';

interface BotStatus {
  id: string;
  name: string;
  capabilities: BotCapability[];
  load: number; // 0-100, representing current load percentage
  lastHeartbeat: Date;
  isAvailable: boolean;
  metadata: Record<string, any>;
}

type TaskType = 'communication' | 'planning' | 'execution' | 'monitoring' | 'analysis';

interface Task {
  id: string;
  type: TaskType;
  priority: number; // 1-10, 10 being highest priority
  requiredCapabilities: BotCapability[];
  data: any;
  createdAt: Date;
  status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed';
  assignedTo?: string;
  result?: any;
  error?: string;
}

export class RoutingService {
  private static instance: RoutingService;
  private bots: Map<string, BotStatus> = new Map();
  private taskQueue: Task[] = [];
  private completedTasks: Map<string, Task> = new Map();
  private taskTimeout = 5 * 60 * 1000; // 5 minutes default timeout

  private constructor() {
    // Private constructor to enforce singleton
  }

  public static getInstance(): RoutingService {
    if (!RoutingService.instance) {
      RoutingService.instance = new RoutingService();
    }
    return RoutingService.instance;
  }

  private taskProcessorInterval: NodeJS.Timeout | null = null;

  public async initialize(): Promise<void> {
    logger.info('Initializing Routing Service');
    
    // Set up WebSocket message handlers
    const wsService = WebSocketService.getInstance();
    wsService.onMessage('bot_heartbeat', this.handleBotHeartbeat.bind(this));
    wsService.onMessage('task_update', this.handleTaskUpdate.bind(this));
    
    // Start task processing loop
    this.taskProcessorInterval = setInterval(() => {
      this.processTasks().catch(error => {
        logger.error('Error in task processor:', error);
      });
    }, 5000); // Process tasks every 5 seconds
    
    logger.info('Routing Service initialized');
  }

  public registerBot(bot: Omit<BotStatus, 'lastHeartbeat' | 'isAvailable' | 'load'>): void {
    const botStatus: BotStatus = {
      ...bot,
      lastHeartbeat: new Date(),
      isAvailable: true,
      load: 0,
      metadata: {}
    };
    
    this.bots.set(bot.id, botStatus);
    logger.info(`Registered bot: ${bot.name} (${bot.id})`);
  }

  public async submitTask(task: Omit<Task, 'id' | 'createdAt' | 'status'>): Promise<string> {
    const newTask: Task = {
      ...task,
      id: this.generateTaskId(),
      createdAt: new Date(),
      status: 'pending'
    };
    
    this.taskQueue.push(newTask);
    logger.info(`New task submitted: ${newTask.id} (${newTask.type})`);
    
    // Trigger immediate processing
    this.processTasks().catch(error => {
      logger.error('Error processing tasks:', error);
    });
    
    return newTask.id;
  }

  public getTaskStatus(taskId: string): Task | undefined {
    // Check in-progress tasks
    const inProgressTask = this.taskQueue.find(t => t.id === taskId);
    if (inProgressTask) return inProgressTask;
    
    // Check completed tasks
    return this.completedTasks.get(taskId);
  }

  private async processTasks(): Promise<void> {
    if (this.taskQueue.length === 0) return;
    
    // Create a working copy of tasks to process
    const tasksToProcess = [...this.taskQueue];
    
    // Sort tasks by priority (highest first) and then by creation time (oldest first)
    tasksToProcess.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority; // Higher priority first
      }
      return a.createdAt.getTime() - b.createdAt.getTime(); // Older first
    });
    
    // Process each task
    for (const task of tasksToProcess) {
      try {
        // Skip if already assigned or no longer in the queue
        if (task.status !== 'pending') continue;
        
        // Find suitable bot
        const bot = this.findSuitableBot(task);
        
        if (bot) {
          // Update task status
          task.status = 'assigned';
          task.assignedTo = bot.id;
          
          // Update bot load
          bot.load += 10; // Simple load increment, can be more sophisticated
          bot.isAvailable = bot.load < 100;
          
          // Send task to bot
          await this.sendTaskToBot(bot.id, task);
          
          // Set timeout for task completion
          this.setTaskTimeout(task.id);
        }
      } catch (error) {
        logger.error(`Error processing task ${task.id}:`, error);
        task.status = 'failed';
        task.error = error instanceof Error ? error.message : 'Unknown error';
      }
    }
    
    // Clean up completed/failed tasks
    this.taskQueue = this.taskQueue.filter(task => 
      task.status === 'pending' || task.status === 'assigned' || task.status === 'in_progress'
    );
  }

  private findSuitableBot(task: Task): BotStatus | undefined {
    if (!task.requiredCapabilities || task.requiredCapabilities.length === 0) {
      logger.warn(`Task ${task.id} has no required capabilities`);
      return undefined;
    }

    const availableBots = Array.from(this.bots.values())
      .filter((bot): bot is BotStatus => {
        if (!bot.isAvailable || bot.load >= 100) return false;
        
        // Check if bot has all required capabilities
        return task.requiredCapabilities.every(capability => 
          bot.capabilities.includes(capability)
        );
      })
      .sort((a, b) => a.load - b.load); // Prefer less loaded bots
    
    if (availableBots.length === 0) {
      logger.debug(`No suitable bot found for task ${task.id} with required capabilities:`, 
        task.requiredCapabilities);
      return undefined;
    }
    
    return availableBots[0]; // Return the least loaded suitable bot
  }

  private async sendTaskToBot(botId: string, task: Task): Promise<void> {
    const bot = this.bots.get(botId);
    if (!bot) {
      logger.warn(`Attempted to send task to non-existent bot: ${botId}`);
      return;
    }
    
    try {
      const wsService = WebSocketService.getInstance();
      await wsService.send(botId, {
        type: 'task_assignment',
        data: {
          taskId: task.id,
          taskType: task.type,
          priority: task.priority,
          payload: task.data
        }
      });
      
      logger.info(`Task ${task.id} assigned to ${bot.name}`);
    } catch (error) {
      logger.error(`Failed to send task ${task.id} to bot ${bot.name}:`, error);
      // Mark task as failed if we can't send it
      task.status = 'failed';
      task.error = 'Failed to assign task to bot';
    }
  }

  private setTaskTimeout(taskId: string): void {
    setTimeout(async () => {
      const task = this.taskQueue.find(t => t.id === taskId);
      if (task && task.status !== 'completed' && task.status !== 'failed') {
        logger.warn(`Task ${taskId} timed out`);
        task.status = 'failed';
        task.error = 'Task timed out';
        
        // Free up the bot if it was assigned
        if (task.assignedTo) {
          const bot = this.bots.get(task.assignedTo);
          if (bot) {
            bot.load = Math.max(0, bot.load - 10);
            bot.isAvailable = bot.load < 100;
          }
        }
      }
    }, this.taskTimeout);
  }

  private handleBotHeartbeat(botId: string, data: any): void {
    const bot = this.bots.get(botId);
    if (!bot) {
      logger.warn(`Received heartbeat from unregistered bot: ${botId}`);
      return;
    }
    
    // Update bot status
    bot.lastHeartbeat = new Date();
    bot.load = data.load || 0;
    bot.isAvailable = data.isAvailable !== false; // Default to true if not specified
    bot.metadata = data.metadata || {};
    
    // If bot just became available, process tasks
    if (bot.isAvailable) {
      this.processTasks().catch(error => {
        logger.error('Error processing tasks after bot heartbeat:', error);
      });
    }
  }

  private handleTaskUpdate(botId: string, data: any): void {
    const { taskId, status, result, error } = data || {};
    
    if (!taskId) {
      logger.warn('Received task update without taskId');
      return;
    }
    
    // Find the task in the queue
    const task = this.taskQueue.find(t => t.id === taskId);
    if (!task) {
      logger.warn(`Received update for unknown task: ${taskId}`);
      return;
    }
    
    // Update task status
    task.status = status;
    
    // Handle task completion/failure
    if (status === 'completed' || status === 'failed') {
      const completedTask: Task = {
        ...task,
        status,
        result: status === 'completed' ? result : undefined,
        error: status === 'failed' ? (error || 'Unknown error') : undefined
      };
      
      // Store completed/failed task
      this.completedTasks.set(taskId, completedTask);
      
      // Free up the bot
      const bot = botId ? this.bots.get(botId) : null;
      if (bot) {
        bot.load = Math.max(0, bot.load - 10);
        bot.isAvailable = bot.load < 100;
      }
      
      if (status === 'completed') {
        logger.info(`Task ${taskId} completed by ${botId || 'unknown'}`);
      } else {
        logger.error(`Task ${taskId} failed: ${completedTask.error}`);
      }
    } else if (status === 'in_progress') {
      logger.debug(`Task ${taskId} is now in progress on ${botId || 'unknown'}`);
    } else {
      logger.debug(`Task ${taskId} status updated to: ${status}`);
    }
    
    // Process next tasks
    this.processTasks().catch(error => {
      logger.error('Error processing tasks after task update:', error);
    });
  }

  private generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  public async shutdown(): Promise<void> {
    // Stop the task processor
    if (this.taskProcessorInterval) {
      clearInterval(this.taskProcessorInterval);
      this.taskProcessorInterval = null;
    }
    
    // Clean up any resources
    this.bots.clear();
    this.taskQueue = [];
    this.completedTasks.clear();
    
    // Remove message handlers
    const wsService = WebSocketService.getInstance();
    wsService.offMessage('bot_heartbeat');
    wsService.offMessage('task_update');
    
    logger.info('Routing Service shutdown');
  }
}

export const routingService = RoutingService.getInstance();
