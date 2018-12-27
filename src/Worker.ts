import { EventEmitter } from 'events';
import {
  Task,
  TaskHandler,
  TaskHelpers,
  TaskResult,
  WorkerConfig,
} from './types';
import { TaskQueue } from './Queue';
import { calculateDelay } from './utils/retry';

const DEFAULT_WORKER_CONFIG: WorkerConfig = {
  concurrency: 1,
  pollInterval: 1000,
  shutdownTimeout: 10000,
};

export class Worker extends EventEmitter {
  private queue: TaskQueue;
  private handlers: Map<string, TaskHandler> = new Map();
  private config: WorkerConfig;
  private running: boolean = false;
  private activeCount: number = 0;
  private pollTimer: NodeJS.Timer | null = null;
  private cancelledTasks: Set<string> = new Set();

  constructor(queue: TaskQueue, config: Partial<WorkerConfig> = {}) {
    super();
    this.queue = queue;
    this.config = { ...DEFAULT_WORKER_CONFIG, ...config };
  }

  register<T = any, R = any>(name: string, handler: TaskHandler<T, R>): void {
    this.handlers.set(name, handler as TaskHandler);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.emit('started');
    this.poll();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer as any);
      this.pollTimer = null;
    }

    // Wait for active tasks to finish
    const deadline = Date.now() + this.config.shutdownTimeout;
    while (this.activeCount > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    this.emit('stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  getActiveCount(): number {
    return this.activeCount;
  }

  private poll(): void {
    if (!this.running) return;

    while (this.activeCount < this.config.concurrency) {
      const task = this.queue.dequeue();
      if (!task) break;
      this.processTask(task);
    }

    this.pollTimer = setTimeout(() => this.poll(), this.config.pollInterval);
  }

  private async processTask(task: Task): Promise<void> {
    const handler = this.handlers.get(task.name);
    if (!handler) {
      this.queue.fail(task.id, `No handler registered for task "${task.name}"`);
      return;
    }

    this.activeCount++;
    const startTime = Date.now();

    // Run beforeProcess middlewares
    const middlewares = this.queue.getMiddlewares();
    for (const mw of middlewares) {
      if (mw.beforeProcess) {
        try {
          await mw.beforeProcess(task);
        } catch (err) {
          // middleware errors are non-fatal, log and continue
        }
      }
    }

    const helpers: TaskHelpers = {
      reportProgress: (percent: number) => {
        task.progress = Math.min(100, Math.max(0, percent));
        this.emit('progress', task.id, task.progress);
      },
      log: (message: string) => {
        this.emit('taskLog', task.id, message);
      },
      isCancelled: () => this.cancelledTasks.has(task.id),
    };

    let taskResult: TaskResult;

    try {
      const result = await this.executeWithTimeout(handler, task, helpers, task.timeout);
      this.queue.complete(task.id, result);

      taskResult = {
        taskId: task.id,
        success: true,
        result,
        duration: Date.now() - startTime,
        attempts: task.attempts + 1,
      };

      this.emit('taskComplete', taskResult);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.queue.fail(task.id, errorMessage);

      taskResult = {
        taskId: task.id,
        success: false,
        error: errorMessage,
        duration: Date.now() - startTime,
        attempts: task.attempts,
      };

      this.emit('taskFailed', taskResult);

      // Schedule retry if applicable
      if (task.status === 'retrying') {
        const delay = calculateDelay(task.attempts, task.retryPolicy);
        setTimeout(() => {
          this.queue.requeueForRetry(task.id);
        }, delay);
      }

      // Run onError middlewares
      for (const mw of middlewares) {
        if (mw.onError) {
          try {
            await mw.onError(task, error instanceof Error ? error : new Error(String(error)));
          } catch (_) {}
        }
      }
    } finally {
      this.activeCount--;

      // Run afterProcess middlewares
      for (const mw of middlewares) {
        if (mw.afterProcess) {
          try {
            await mw.afterProcess(task, taskResult!);
          } catch (_) {}
        }
      }
    }
  }

  private executeWithTimeout<T, R>(
    handler: TaskHandler<T, R>,
    task: Task<T, R>,
    helpers: TaskHelpers,
    timeout: number
  ): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Task "${task.name}" timed out after ${timeout}ms`));
      }, timeout);

      handler(task, helpers)
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  cancelTask(taskId: string): void {
    this.cancelledTasks.add(taskId);
    this.queue.cancel(taskId);
  }
}
