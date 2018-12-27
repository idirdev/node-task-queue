# node-task-queue

[![TypeScript](https://img.shields.io/badge/TypeScript-3.6-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D10-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A lightweight, in-memory background task queue system for Node.js applications. Supports priority scheduling, retries with backoff, recurring tasks, middleware, and metrics collection.

## Features

- **Priority Queue** - Tasks are processed by priority: critical > high > normal > low
- **Retry with Backoff** - Fixed, exponential, or linear backoff strategies with optional jitter
- **Delayed Tasks** - Schedule tasks to run at a specific time
- **Task Groups** - Organize tasks into logical groups for batch operations
- **Concurrency Control** - Configure how many tasks a worker processes in parallel
- **Timeout Handling** - Automatic task timeout with configurable duration
- **Progress Reporting** - Tasks can report their completion percentage
- **Cron Scheduling** - Schedule recurring tasks with cron expressions or fixed intervals
- **Middleware System** - Hook into task lifecycle (before, after, error)
- **Metrics Collection** - Track throughput, latency (avg/p95), error rates, queue depth
- **Task Persistence** - In-memory store with export/import for snapshots
- **Event-Driven** - EventEmitter-based architecture for monitoring
- **Pause/Resume** - Pause queue processing and resume on demand

## Installation

```bash
npm install
npm run build
```

## Quick Start

```typescript
import { TaskQueue, Worker } from 'node-task-queue';

// Create a queue
const queue = new TaskQueue({ name: 'my-queue' });

// Create a worker
const worker = new Worker(queue, { concurrency: 2 });

// Register a task handler
worker.register('greet', async (task, helpers) => {
  helpers.reportProgress(50);
  const message = `Hello, ${task.data.name}!`;
  helpers.reportProgress(100);
  return message;
});

// Start processing
worker.start();

// Enqueue a task
const task = queue.enqueue('greet', { name: 'World' }, {
  priority: 'high',
});

console.log(`Enqueued task: ${task.id}`);
```

## API Reference

### TaskQueue

```typescript
const queue = new TaskQueue({
  name: 'my-queue',       // Queue name (default: 'default')
  maxSize: 10000,          // Max tasks in queue (default: 10000)
  defaultPriority: 'normal',
  defaultTimeout: 30000,   // 30 seconds
  defaultRetryPolicy: {
    maxRetries: 3,
    strategy: 'exponential',
    baseDelay: 1000,
    maxDelay: 30000,
    jitter: true,
  },
});
```

| Method | Description |
|--------|-------------|
| `enqueue(name, data, options?)` | Add a task to the queue |
| `dequeue()` | Get the next task to process |
| `complete(taskId, result)` | Mark a task as completed |
| `fail(taskId, error)` | Mark a task as failed |
| `cancel(taskId)` | Cancel a pending/running task |
| `pause()` / `resume()` | Pause/resume queue processing |
| `findById(id)` | Look up a task by ID |
| `findByGroup(group)` | Get all tasks in a group |
| `findByStatus(status)` | Get tasks by status |
| `getStats()` | Get queue statistics |
| `use(middleware)` | Register middleware |
| `size()` | Number of pending tasks |
| `clear()` | Remove all tasks |

### Worker

```typescript
const worker = new Worker(queue, {
  concurrency: 4,          // Parallel task limit (default: 1)
  pollInterval: 1000,      // Poll interval in ms (default: 1000)
  shutdownTimeout: 10000,  // Graceful shutdown timeout (default: 10000)
});
```

| Method | Description |
|--------|-------------|
| `register(name, handler)` | Register a task handler |
| `start()` | Start processing tasks |
| `stop()` | Gracefully stop the worker |
| `cancelTask(taskId)` | Cancel a specific task |
| `isRunning()` | Check if worker is active |
| `getActiveCount()` | Number of tasks being processed |

### Task Handler

```typescript
worker.register('my-task', async (task, helpers) => {
  helpers.reportProgress(25);     // Report progress (0-100)
  helpers.log('Processing...');    // Log a message
  if (helpers.isCancelled()) {     // Check cancellation
    return;
  }
  return { result: 'done' };
});
```

### Scheduler

```typescript
const scheduler = new Scheduler(queue);

// Interval-based (every 5 minutes)
scheduler.schedule('cleanup', {}, { interval: 300000 });

// Cron-based (every day at 9:00 AM)
scheduler.schedule('daily-report', { type: 'daily' }, {
  cron: '0 9 * * *',
  priority: 'high',
});

scheduler.start();
```

### TaskStore

```typescript
const store = new TaskStore(queue);

// Find tasks
store.findById('task-id');
store.findByStatus('completed');
store.findByGroup('emails');

// Cleanup old tasks (older than 1 hour)
store.cleanupCompleted(3600000);

// Auto-cleanup every 10 minutes
store.startAutoCleanup(600000, 3600000);

// Export/import snapshots
const snapshot = store.export();
store.import(snapshot);
```

### Middleware

```typescript
import { createLoggingMiddleware } from 'node-task-queue';

// Built-in logging middleware
queue.use(createLoggingMiddleware({
  prefix: '[Queue]',
  logTimestamp: true,
  logData: false,
  logResult: false,
}));

// Custom middleware
queue.use({
  beforeProcess(task) {
    console.log(`Starting: ${task.name}`);
  },
  afterProcess(task, result) {
    console.log(`Finished: ${task.name} in ${result.duration}ms`);
  },
  onError(task, error) {
    console.error(`Error in ${task.name}: ${error.message}`);
  },
});
```

### Metrics

```typescript
import { MetricsCollector } from 'node-task-queue';

const metrics = new MetricsCollector(queue);
queue.use(metrics);

// Get a snapshot of current metrics
const snapshot = metrics.getSnapshot();
console.log(snapshot);
// {
//   timestamp: Date,
//   tasksProcessed: 150,
//   tasksFailed: 3,
//   avgLatency: 245,         // ms
//   p95Latency: 890,         // ms
//   queueDepth: 12,
//   throughputPerMinute: 48.5,
//   errorRate: 2.0,          // percent
//   activeWorkers: 2,
// }
```

### Retry Strategies

```typescript
// Fixed delay: always wait 5 seconds
{ strategy: 'fixed', baseDelay: 5000 }

// Linear backoff: 1s, 2s, 3s, 4s...
{ strategy: 'linear', baseDelay: 1000 }

// Exponential backoff: 1s, 2s, 4s, 8s...
{ strategy: 'exponential', baseDelay: 1000 }

// With jitter to prevent thundering herd
{ strategy: 'exponential', baseDelay: 1000, jitter: true }
```

## Task Status Lifecycle

```
pending -> queued -> running -> completed
                  |          -> failed
                  |          -> retrying -> queued (retry)
                  -> cancelled
```

## Running the Example

```bash
npx ts-node examples/basic.ts
```

## License

MIT
