import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';

// Define task status types
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

// Define task priority levels (1=highest, 5=lowest)
export type TaskPriority = 1 | 2 | 3 | 4 | 5;

// Task interface
export interface Task {
  id: string;
  type: string;
  status: TaskStatus;
  priority: TaskPriority;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  assignedTo?: string;
  startedAt?: Date;
  completedAt?: Date;
  metadata?: Record<string, any>;
  result?: Record<string, any>;
  error?: string;
  retryCount: number;
  maxRetries: number;
}

// Task filter options
interface TaskFilterOptions {
  status?: TaskStatus;
  type?: string;
  assignedTo?: string;
  createdBy?: string;
}

// Task query options
interface TaskQueryOptions {
  filter?: TaskFilterOptions;
  limit: number;
  offset: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

// Task creation options
interface CreateTaskOptions {
  type: string;
  priority?: TaskPriority;
  createdBy: string;
  assignedTo?: string;
  metadata?: Record<string, any>;
  maxRetries?: number;
}

class TaskManager {
  private static instance: TaskManager;
  private tasks: Map<string, Task> = new Map();
  private taskQueue: string[] = [];

  private constructor() {
    // Initialize with some sample tasks in development
    if (process.env.NODE_ENV === 'development') {
      this.initializeSampleTasks();
    }
  }

  public static getInstance(): TaskManager {
    if (!TaskManager.instance) {
      TaskManager.instance = new TaskManager();
    }
    return TaskManager.instance;
  }

  private initializeSampleTasks(): void {
    const now = new Date();
    const sampleTasks: Task[] = [
      {
        id: uuidv4(),
        type: 'data_sync',
        status: 'completed',
        priority: 3,
        createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 2), // 2 hours ago
        updatedAt: new Date(now.getTime() - 1000 * 60 * 60), // 1 hour ago
        createdBy: 'system',
        assignedTo: 'worker-1',
        startedAt: new Date(now.getTime() - 1000 * 60 * 65), // 1h5m ago
        completedAt: new Date(now.getTime() - 1000 * 60 * 60), // 1h ago
        metadata: { source: 'api', target: 'database' },
        result: { processed: 1245, failed: 3 },
        retryCount: 0,
        maxRetries: 3,
      },
      {
        id: uuidv4(),
        type: 'report_generation',
        status: 'in_progress',
        priority: 2,
        createdAt: new Date(now.getTime() - 1000 * 60 * 30), // 30 minutes ago
        updatedAt: new Date(now.getTime() - 1000 * 60 * 5), // 5 minutes ago
        createdBy: 'user-123',
        assignedTo: 'worker-2',
        startedAt: new Date(now.getTime() - 1000 * 60 * 10), // 10 minutes ago
        metadata: { reportType: 'daily_summary', date: now.toISOString().split('T')[0] },
        retryCount: 0,
        maxRetries: 3,
      },
      {
        id: uuidv4(),
        type: 'backup',
        status: 'pending',
        priority: 4,
        createdAt: new Date(now.getTime() - 1000 * 60 * 15), // 15 minutes ago
        updatedAt: new Date(now.getTime() - 1000 * 60 * 15), // 15 minutes ago
        createdBy: 'system',
        metadata: { target: 's3://backups/db' },
        retryCount: 0,
        maxRetries: 3,
      },
    ];

    sampleTasks.forEach(task => {
      this.tasks.set(task.id, task);
      if (task.status === 'pending') {
        this.taskQueue.push(task.id);
      }
    });
  }

  public async createTask(options: CreateTaskOptions): Promise<Task> {
    const now = new Date();
    const task: Task = {
      id: uuidv4(),
      type: options.type,
      status: 'pending',
      priority: options.priority || 3,
      createdAt: now,
      updatedAt: now,
      createdBy: options.createdBy,
      assignedTo: options.assignedTo,
      metadata: options.metadata,
      retryCount: 0,
      maxRetries: options.maxRetries ?? 3,
    };

    this.tasks.set(task.id, task);
    this.taskQueue.push(task.id);
    this.prioritizeQueue();

    logger.info('Created new task', { taskId: task.id, type: task.type });
    return { ...task };
  }

  public async getTask(taskId: string): Promise<Task | null> {
    const task = this.tasks.get(taskId);
    return task ? { ...task } : null;
  }

  public async getTasks(options: TaskQueryOptions): Promise<{ tasks: Task[]; total: number }> {
    const { filter = {}, limit, offset, sortBy, sortOrder } = options;
    
    // Filter tasks
    let filteredTasks = Array.from(this.tasks.values());
    
    if (filter.status) {
      filteredTasks = filteredTasks.filter(task => task.status === filter.status);
    }
    if (filter.type) {
      filteredTasks = filteredTasks.filter(task => task.type === filter.type);
    }
    if (filter.assignedTo) {
      filteredTasks = filteredTasks.filter(task => task.assignedTo === filter.assignedTo);
    }
    if (filter.createdBy) {
      filteredTasks = filteredTasks.filter(task => task.createdBy === filter.createdBy);
    }

    // Sort tasks
    filteredTasks.sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case 'createdAt':
          comparison = a.createdAt.getTime() - b.createdAt.getTime();
          break;
        case 'updatedAt':
          comparison = (a.updatedAt?.getTime() || 0) - (b.updatedAt?.getTime() || 0);
          break;
        case 'priority':
          comparison = a.priority - b.priority;
          break;
        default:
          comparison = a.createdAt.getTime() - b.createdAt.getTime();
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });

    // Apply pagination
    const total = filteredTasks.length;
    const paginatedTasks = filteredTasks.slice(offset, offset + limit);

    return {
      tasks: paginatedTasks.map(task => ({ ...task })),
      total,
    };
  }

  public async cancelTask(taskId: string, userId: string): Promise<Task | null> {
    const task = this.tasks.get(taskId);
    
    if (!task) {
      return null;
    }

    // Only allow cancelling pending or in-progress tasks
    if (task.status !== 'pending' && task.status !== 'in_progress') {
      throw new Error(`Cannot cancel task with status: ${task.status}`);
    }

    // Update task status
    const updatedTask: Task = {
      ...task,
      status: 'cancelled',
      updatedAt: new Date(),
      error: `Cancelled by user ${userId}`,
    };

    this.tasks.set(taskId, updatedTask);
    
    // Remove from queue if it's there
    const queueIndex = this.taskQueue.indexOf(taskId);
    if (queueIndex !== -1) {
      this.taskQueue.splice(queueIndex, 1);
    }

    logger.info('Cancelled task', { taskId, cancelledBy: userId });
    return { ...updatedTask };
  }

  public async getNextTask(workerId: string): Promise<Task | null> {
    if (this.taskQueue.length === 0) {
      return null;
    }

    // Get the highest priority task
    const taskId = this.taskQueue.shift()!;
    const task = this.tasks.get(taskId);

    if (!task) {
      // Task was removed, try next one
      return this.getNextTask(workerId);
    }

    // Update task status
    const updatedTask: Task = {
      ...task,
      status: 'in_progress',
      updatedAt: new Date(),
      startedAt: new Date(),
      assignedTo: workerId,
    };

    this.tasks.set(taskId, updatedTask);
    return { ...updatedTask };
  }

  public async completeTask(taskId: string, result?: Record<string, any>): Promise<boolean> {
    const task = this.tasks.get(taskId);
    
    if (!task || task.status !== 'in_progress') {
      return false;
    }

    const now = new Date();
    const updatedTask: Task = {
      ...task,
      status: 'completed',
      updatedAt: now,
      completedAt: now,
      result,
    };

    this.tasks.set(taskId, updatedTask);
    logger.info('Completed task', { taskId, type: task.type });
    return true;
  }

  public async failTask(taskId: string, error: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    
    if (!task) {
      return false;
    }

    const now = new Date();
    const retryCount = task.retryCount + 1;
    const shouldRetry = retryCount < task.maxRetries;

    const updatedTask: Task = {
      ...task,
      status: shouldRetry ? 'pending' : 'failed',
      updatedAt: now,
      error,
      retryCount,
    };

    this.tasks.set(taskId, updatedTask);

    if (shouldRetry) {
      // Requeue for retry
      this.taskQueue.push(taskId);
      this.prioritizeQueue();
      logger.warn('Task failed, will retry', { taskId, retryCount });
    } else {
      logger.error('Task failed after max retries', { taskId, error });
    }

    return true;
  }

  private prioritizeQueue(): void {
    // Sort the queue by priority (ascending) and creation time (ascending)
    this.taskQueue.sort((a, b) => {
      const taskA = this.tasks.get(a);
      const taskB = this.tasks.get(b);
      
      if (!taskA || !taskB) return 0;
      
      // First sort by priority (lower number = higher priority)
      if (taskA.priority !== taskB.priority) {
        return taskA.priority - taskB.priority;
      }
      
      // Then by creation time (older first)
      return taskA.createdAt.getTime() - taskB.createdAt.getTime();
    });
  }
}

export const taskManager = TaskManager.getInstance();

export default TaskManager;
