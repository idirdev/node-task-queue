import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import {
  Task,
  TaskPriority,
  TaskStatus,
  QueueConfig,
  QueueStats,
  RetryPolicy,
  Middleware,
} from './types';

const PRIORITY_WEIGHTS: Record<TaskPriority, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
};

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  strategy: 'exponential',
  baseDelay: 1000,
  maxDelay: 30000,
  jitter: true,
};

const DEFAULT_CONFIG: QueueConfig = {
  name: 'default',
  maxSize: 10000,
  defaultPriority: 'normal',
  defaultRetryPolicy: DEFAULT_RETRY_POLICY,
  defaultTimeout: 30000,
  staleTaskTimeout: 300000,
};

export class TaskQueue extends EventEmitter {
  private tasks: Task[] = [];
  private config: QueueConfig;
  private paused: boolean = false;
  private middlewares: Middleware[] = [];
  private completedCount: number = 0;
  private failedCount: number = 0;
  private totalDuration: number = 0;
  private startTime: number = Date.now();

  constructor(config: Partial<QueueConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  enqueue<T = any>(
    name: string,
    data: T,
    options: {
      priority?: TaskPriority;
      group?: string;
      scheduledFor?: Date;
      retryPolicy?: Partial<RetryPolicy>;
      timeout?: number;
      meta?: Record<string, any>;
    } = {}
  ): Task<T> {
    if (this.tasks.length >= this.config.maxSize) {
      throw new Error(
        `Queue "${this.config.name}" is full (max: ${this.config.maxSize})`
      );
    }

    const task: Task<T> = {
      id: uuidv4(),
      name,
      data,
      status: options.scheduledFor ? 'pending' : 'queued',
      priority: options.priority || this.config.defaultPriority,
      group: options.group,
      createdAt: new Date(),
      scheduledFor: options.scheduledFor,
      attempts: 0,
      retryPolicy: {
        ...this.config.defaultRetryPolicy,
        ...(options.retryPolicy || {}),
      },
      timeout: options.timeout || this.config.defaultTimeout,
      progress: 0,
      meta: options.meta || {},
    };

    this.tasks.push(task);
    this.sortByPriority();
    this.emit('enqueued', task);

    return task;
  }

  dequeue(): Task | undefined {
    if (this.paused) return undefined;

    const now = new Date();

    // Promote pending scheduled tasks that are ready
    for (const task of this.tasks) {
      if (
        task.status === 'pending' &&
        task.scheduledFor &&
        task.scheduledFor <= now
      ) {
        task.status = 'queued';
      }
    }

    const index = this.tasks.findIndex((t) => t.status === 'queued');
    if (index === -1) return undefined;

    const task = this.tasks[index];
    task.status = 'running';
    task.startedAt = new Date();
    this.emit('dequeued', task);

    return task;
  }

  complete<R = any>(taskId: string, result: R): void {
    const task = this.findById(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    task.status = 'completed';
    task.result = result;
    task.completedAt = new Date();
    task.progress = 100;

    const duration = task.completedAt.getTime() - (task.startedAt?.getTime() || task.createdAt.getTime());
    this.totalDuration += duration;
    this.completedCount++;

    this.emit('completed', task);
  }

  fail(taskId: string, error: string): void {
    const task = this.findById(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    task.error = error;
    task.attempts++;

    if (task.attempts < task.retryPolicy.maxRetries) {
      task.status = 'retrying';
      this.emit('retrying', task);
    } else {
      task.status = 'failed';
      task.completedAt = new Date();
      this.failedCount++;
      this.emit('failed', task);
    }
  }

  requeueForRetry(taskId: string): void {
    const task = this.findById(taskId);
    if (!task || task.status !== 'retrying') return;
    task.status = 'queued';
    task.startedAt = undefined;
    this.sortByPriority();
  }

  cancel(taskId: string): boolean {
    const task = this.findById(taskId);
    if (!task || task.status === 'completed' || task.status === 'failed') return false;
    task.status = 'cancelled';
    task.completedAt = new Date();
    this.emit('cancelled', task);
    return true;
  }

  pause(): void {
    this.paused = true;
    this.emit('paused');
  }

  resume(): void {
    this.paused = false;
    this.emit('resumed');
  }

  isPaused(): boolean {
    return this.paused;
  }

  findById(id: string): Task | undefined {
    return this.tasks.find((t) => t.id === id);
  }

  findByGroup(group: string): Task[] {
    return this.tasks.filter((t) => t.group === group);
  }

  findByStatus(status: TaskStatus): Task[] {
    return this.tasks.filter((t) => t.status === status);
  }

  use(middleware: Middleware): void {
    this.middlewares.push(middleware);
  }

  getMiddlewares(): Middleware[] {
    return [...this.middlewares];
  }

  getStats(): QueueStats {
    const elapsedMinutes = (Date.now() - this.startTime) / 60000;
    return {
      pending: this.tasks.filter((t) => t.status === 'pending' || t.status === 'queued').length,
      running: this.tasks.filter((t) => t.status === 'running').length,
      completed: this.completedCount,
      failed: this.failedCount,
      total: this.tasks.length,
      avgDuration: this.completedCount > 0 ? this.totalDuration / this.completedCount : 0,
      throughput: elapsedMinutes > 0 ? this.completedCount / elapsedMinutes : 0,
    };
  }

  size(): number {
    return this.tasks.filter(
      (t) => t.status === 'queued' || t.status === 'pending'
    ).length;
  }

  clear(): void {
    const removed = this.tasks.length;
    this.tasks = [];
    this.emit('cleared', removed);
  }

  private sortByPriority(): void {
    this.tasks.sort((a, b) => {
      if (a.status !== 'queued' && b.status === 'queued') return 1;
      if (a.status === 'queued' && b.status !== 'queued') return -1;
      return PRIORITY_WEIGHTS[b.priority] - PRIORITY_WEIGHTS[a.priority];
    });
  }
}
