import { describe, it, expect, vi } from 'vitest';
import { TaskQueue } from '../src/Queue';
import { Worker } from '../src/Worker';
import { calculateDelay, createRetryPolicy, isRetryableError } from '../src/utils/retry';

describe('TaskQueue', () => {
  it('should create with default config', () => {
    const queue = new TaskQueue();
    expect(queue.size()).toBe(0);
    expect(queue.isPaused()).toBe(false);
  });

  it('should create with custom config', () => {
    const queue = new TaskQueue({ name: 'test-queue', maxSize: 100 });
    expect(queue.size()).toBe(0);
  });

  describe('enqueue', () => {
    it('should enqueue a task', () => {
      const queue = new TaskQueue();
      const task = queue.enqueue('test-task', { value: 42 });
      expect(task.name).toBe('test-task');
      expect(task.data).toEqual({ value: 42 });
      expect(task.status).toBe('queued');
      expect(task.id).toBeTruthy();
      expect(queue.size()).toBe(1);
    });

    it('should assign default priority', () => {
      const queue = new TaskQueue();
      const task = queue.enqueue('test', {});
      expect(task.priority).toBe('normal');
    });

    it('should accept custom priority', () => {
      const queue = new TaskQueue();
      const task = queue.enqueue('test', {}, { priority: 'high' });
      expect(task.priority).toBe('high');
    });

    it('should set status to pending when scheduledFor is set', () => {
      const queue = new TaskQueue();
      const futureDate = new Date(Date.now() + 60000);
      const task = queue.enqueue('scheduled', {}, { scheduledFor: futureDate });
      expect(task.status).toBe('pending');
    });

    it('should assign group when provided', () => {
      const queue = new TaskQueue();
      const task = queue.enqueue('test', {}, { group: 'batch-1' });
      expect(task.group).toBe('batch-1');
    });

    it('should throw when queue is full', () => {
      const queue = new TaskQueue({ maxSize: 2 } as any);
      queue.enqueue('t1', {});
      queue.enqueue('t2', {});
      expect(() => queue.enqueue('t3', {})).toThrow(/full/);
    });

    it('should emit enqueued event', () => {
      const queue = new TaskQueue();
      const handler = vi.fn();
      queue.on('enqueued', handler);
      queue.enqueue('test', {});
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('dequeue', () => {
    it('should dequeue the highest priority task', () => {
      const queue = new TaskQueue();
      queue.enqueue('low', {}, { priority: 'low' });
      queue.enqueue('critical', {}, { priority: 'critical' });
      queue.enqueue('normal', {}, { priority: 'normal' });

      const task = queue.dequeue();
      expect(task).toBeDefined();
      expect(task!.name).toBe('critical');
      expect(task!.status).toBe('running');
    });

    it('should return undefined when queue is empty', () => {
      const queue = new TaskQueue();
      expect(queue.dequeue()).toBeUndefined();
    });

    it('should return undefined when paused', () => {
      const queue = new TaskQueue();
      queue.enqueue('test', {});
      queue.pause();
      expect(queue.dequeue()).toBeUndefined();
    });

    it('should promote scheduled tasks that are ready', () => {
      const queue = new TaskQueue();
      const pastDate = new Date(Date.now() - 1000);
      queue.enqueue('scheduled', {}, { scheduledFor: pastDate });
      const task = queue.dequeue();
      expect(task).toBeDefined();
      expect(task!.name).toBe('scheduled');
    });
  });

  describe('complete', () => {
    it('should mark task as completed', () => {
      const queue = new TaskQueue();
      const task = queue.enqueue('test', {});
      queue.dequeue(); // sets it to running
      queue.complete(task.id, { success: true });

      const found = queue.findById(task.id);
      expect(found!.status).toBe('completed');
      expect(found!.result).toEqual({ success: true });
      expect(found!.progress).toBe(100);
    });

    it('should throw for unknown task ID', () => {
      const queue = new TaskQueue();
      expect(() => queue.complete('nonexistent', {})).toThrow(/not found/);
    });

    it('should emit completed event', () => {
      const queue = new TaskQueue();
      const handler = vi.fn();
      queue.on('completed', handler);
      const task = queue.enqueue('test', {});
      queue.dequeue();
      queue.complete(task.id, {});
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('fail', () => {
    it('should set task to retrying when attempts remain', () => {
      const queue = new TaskQueue();
      const task = queue.enqueue('test', {});
      queue.dequeue();
      queue.fail(task.id, 'Something went wrong');

      const found = queue.findById(task.id);
      expect(found!.status).toBe('retrying');
      expect(found!.error).toBe('Something went wrong');
      expect(found!.attempts).toBe(1);
    });

    it('should set task to failed when max retries exhausted', () => {
      const queue = new TaskQueue();
      const task = queue.enqueue('test', {}, { retryPolicy: { maxRetries: 1 } });
      queue.dequeue();
      queue.fail(task.id, 'Error 1');

      const found = queue.findById(task.id);
      expect(found!.status).toBe('failed');
    });
  });

  describe('cancel', () => {
    it('should cancel a queued task', () => {
      const queue = new TaskQueue();
      const task = queue.enqueue('test', {});
      const result = queue.cancel(task.id);
      expect(result).toBe(true);
      expect(queue.findById(task.id)!.status).toBe('cancelled');
    });

    it('should not cancel a completed task', () => {
      const queue = new TaskQueue();
      const task = queue.enqueue('test', {});
      queue.dequeue();
      queue.complete(task.id, {});
      const result = queue.cancel(task.id);
      expect(result).toBe(false);
    });
  });

  describe('pause and resume', () => {
    it('should pause and resume the queue', () => {
      const queue = new TaskQueue();
      queue.pause();
      expect(queue.isPaused()).toBe(true);
      queue.resume();
      expect(queue.isPaused()).toBe(false);
    });
  });

  describe('findByGroup', () => {
    it('should find tasks by group', () => {
      const queue = new TaskQueue();
      queue.enqueue('t1', {}, { group: 'batch-1' });
      queue.enqueue('t2', {}, { group: 'batch-1' });
      queue.enqueue('t3', {}, { group: 'batch-2' });

      const batch1 = queue.findByGroup('batch-1');
      expect(batch1).toHaveLength(2);
    });
  });

  describe('findByStatus', () => {
    it('should find tasks by status', () => {
      const queue = new TaskQueue();
      queue.enqueue('t1', {});
      queue.enqueue('t2', {});
      const queued = queue.findByStatus('queued');
      expect(queued).toHaveLength(2);
    });
  });

  describe('getStats', () => {
    it('should return queue statistics', () => {
      const queue = new TaskQueue();
      queue.enqueue('t1', {});
      queue.enqueue('t2', {});

      const stats = queue.getStats();
      expect(stats.pending).toBe(2);
      expect(stats.running).toBe(0);
      expect(stats.completed).toBe(0);
      expect(stats.failed).toBe(0);
      expect(stats.total).toBe(2);
    });
  });

  describe('clear', () => {
    it('should remove all tasks', () => {
      const queue = new TaskQueue();
      queue.enqueue('t1', {});
      queue.enqueue('t2', {});
      queue.clear();
      expect(queue.size()).toBe(0);
    });
  });

  describe('middleware', () => {
    it('should register middleware', () => {
      const queue = new TaskQueue();
      const mw = { beforeProcess: vi.fn() };
      queue.use(mw);
      expect(queue.getMiddlewares()).toHaveLength(1);
    });
  });
});

describe('Worker', () => {
  it('should register handlers', () => {
    const queue = new TaskQueue();
    const worker = new Worker(queue);
    worker.register('test', async (task) => task.data);
    // No error means success
    expect(true).toBe(true);
  });

  it('should start and stop', async () => {
    const queue = new TaskQueue();
    const worker = new Worker(queue, { pollInterval: 50, concurrency: 1 });
    worker.register('test', async (task) => task.data);

    worker.start();
    expect(worker.isRunning()).toBe(true);
    expect(worker.getActiveCount()).toBe(0);

    await worker.stop();
    expect(worker.isRunning()).toBe(false);
  });

  it('should process tasks', async () => {
    const queue = new TaskQueue();
    const worker = new Worker(queue, { pollInterval: 50, concurrency: 1 });

    const results: string[] = [];
    worker.register('greeting', async (task) => {
      results.push(`Hello ${task.data.name}`);
      return `Hello ${task.data.name}`;
    });

    queue.enqueue('greeting', { name: 'World' });

    worker.start();

    // Wait for task to be processed
    await new Promise((resolve) => setTimeout(resolve, 200));

    await worker.stop();

    expect(results).toContain('Hello World');
  });
});

describe('calculateDelay', () => {
  it('should return fixed delay for fixed strategy', () => {
    const policy = createRetryPolicy({ strategy: 'fixed', baseDelay: 1000, jitter: false });
    expect(calculateDelay(0, policy)).toBe(1000);
    expect(calculateDelay(1, policy)).toBe(1000);
    expect(calculateDelay(5, policy)).toBe(1000);
  });

  it('should calculate linear delay', () => {
    const policy = createRetryPolicy({ strategy: 'linear', baseDelay: 1000, jitter: false, maxDelay: 100000 });
    expect(calculateDelay(0, policy)).toBe(1000);  // 1000 * 1
    expect(calculateDelay(1, policy)).toBe(2000);  // 1000 * 2
    expect(calculateDelay(2, policy)).toBe(3000);  // 1000 * 3
  });

  it('should calculate exponential delay', () => {
    const policy = createRetryPolicy({ strategy: 'exponential', baseDelay: 1000, jitter: false, maxDelay: 100000 });
    expect(calculateDelay(0, policy)).toBe(1000);  // 1000 * 2^0
    expect(calculateDelay(1, policy)).toBe(2000);  // 1000 * 2^1
    expect(calculateDelay(2, policy)).toBe(4000);  // 1000 * 2^2
    expect(calculateDelay(3, policy)).toBe(8000);  // 1000 * 2^3
  });

  it('should clamp to maxDelay', () => {
    const policy = createRetryPolicy({ strategy: 'exponential', baseDelay: 1000, jitter: false, maxDelay: 5000 });
    expect(calculateDelay(10, policy)).toBe(5000);
  });

  it('should apply jitter when enabled', () => {
    const policy = createRetryPolicy({ strategy: 'fixed', baseDelay: 10000, jitter: true });
    const delay = calculateDelay(0, policy);
    // Jitter makes the delay random between 0 and baseDelay
    expect(delay).toBeGreaterThanOrEqual(0);
    expect(delay).toBeLessThanOrEqual(10000);
  });
});

describe('createRetryPolicy', () => {
  it('should create default policy', () => {
    const policy = createRetryPolicy();
    expect(policy.maxRetries).toBe(3);
    expect(policy.strategy).toBe('exponential');
    expect(policy.baseDelay).toBe(1000);
    expect(policy.maxDelay).toBe(30000);
    expect(policy.jitter).toBe(true);
  });

  it('should apply overrides', () => {
    const policy = createRetryPolicy({ maxRetries: 5, strategy: 'linear' });
    expect(policy.maxRetries).toBe(5);
    expect(policy.strategy).toBe('linear');
    expect(policy.baseDelay).toBe(1000); // default preserved
  });
});

describe('isRetryableError', () => {
  it('should return true for generic errors', () => {
    expect(isRetryableError(new Error('Connection timed out'))).toBe(true);
  });

  it('should return true for server errors', () => {
    expect(isRetryableError(new Error('Internal server error'))).toBe(true);
  });

  it('should return false for validation errors', () => {
    expect(isRetryableError(new Error('VALIDATION_ERROR: invalid input'))).toBe(false);
  });

  it('should return false for unauthorized errors', () => {
    expect(isRetryableError(new Error('UNAUTHORIZED: invalid token'))).toBe(false);
  });

  it('should return false for not found errors', () => {
    expect(isRetryableError(new Error('NOT_FOUND: resource missing'))).toBe(false);
  });

  it('should return false for forbidden errors', () => {
    expect(isRetryableError(new Error('FORBIDDEN: access denied'))).toBe(false);
  });
});
