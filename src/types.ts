export type TaskStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'retrying'
  | 'cancelled'
  | 'paused';

export type TaskPriority = 'low' | 'normal' | 'high' | 'critical';

export interface RetryPolicy {
  maxRetries: number;
  strategy: 'fixed' | 'exponential' | 'linear';
  baseDelay: number;
  maxDelay: number;
  jitter: boolean;
}

export interface Task<T = any, R = any> {
  id: string;
  name: string;
  data: T;
  status: TaskStatus;
  priority: TaskPriority;
  group?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  scheduledFor?: Date;
  result?: R;
  error?: string;
  attempts: number;
  retryPolicy: RetryPolicy;
  timeout: number;
  progress: number;
  meta: Record<string, any>;
}

export type TaskHandler<T = any, R = any> = (
  task: Task<T, R>,
  helpers: TaskHelpers
) => Promise<R>;

export interface TaskHelpers {
  reportProgress(percent: number): void;
  log(message: string): void;
  isCancelled(): boolean;
}

export interface QueueConfig {
  name: string;
  maxSize: number;
  defaultPriority: TaskPriority;
  defaultRetryPolicy: RetryPolicy;
  defaultTimeout: number;
  staleTaskTimeout: number;
}

export interface WorkerConfig {
  concurrency: number;
  pollInterval: number;
  shutdownTimeout: number;
}

export interface TaskResult<R = any> {
  taskId: string;
  success: boolean;
  result?: R;
  error?: string;
  duration: number;
  attempts: number;
}

export interface QueueStats {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  total: number;
  avgDuration: number;
  throughput: number;
}

export interface ScheduleEntry {
  id: string;
  taskName: string;
  taskData: any;
  cron?: string;
  interval?: number;
  nextRun: Date;
  lastRun?: Date;
  enabled: boolean;
}

export interface Middleware {
  beforeProcess?(task: Task): Promise<void> | void;
  afterProcess?(task: Task, result: TaskResult): Promise<void> | void;
  onError?(task: Task, error: Error): Promise<void> | void;
}

export interface MetricsSnapshot {
  timestamp: Date;
  tasksProcessed: number;
  tasksFailed: number;
  avgLatency: number;
  p95Latency: number;
  queueDepth: number;
  throughputPerMinute: number;
  errorRate: number;
  activeWorkers: number;
}
