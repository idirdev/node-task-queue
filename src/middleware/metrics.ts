import { Middleware, Task, TaskResult, MetricsSnapshot } from '../types';
import { TaskQueue } from '../Queue';

export class MetricsCollector implements Middleware {
  private processed: number = 0;
  private failed: number = 0;
  private latencies: number[] = [];
  private startTime: number = Date.now();
  private queue: TaskQueue;
  private activeWorkers: number = 0;
  private maxLatencySamples: number;

  constructor(queue: TaskQueue, maxLatencySamples: number = 1000) {
    this.queue = queue;
    this.maxLatencySamples = maxLatencySamples;
  }

  beforeProcess(_task: Task): void {
    this.activeWorkers++;
  }

  afterProcess(_task: Task, result: TaskResult): void {
    this.activeWorkers = Math.max(0, this.activeWorkers - 1);
    this.processed++;

    if (!result.success) {
      this.failed++;
    }

    this.latencies.push(result.duration);
    if (this.latencies.length > this.maxLatencySamples) {
      this.latencies.shift();
    }
  }

  onError(_task: Task, _error: Error): void {
    this.activeWorkers = Math.max(0, this.activeWorkers - 1);
  }

  getSnapshot(): MetricsSnapshot {
    const elapsedMinutes = (Date.now() - this.startTime) / 60000;
    const sortedLatencies = [...this.latencies].sort((a, b) => a - b);

    const avgLatency =
      sortedLatencies.length > 0
        ? sortedLatencies.reduce((sum, l) => sum + l, 0) / sortedLatencies.length
        : 0;

    const p95Index = Math.floor(sortedLatencies.length * 0.95);
    const p95Latency =
      sortedLatencies.length > 0 ? sortedLatencies[p95Index] || 0 : 0;

    const stats = this.queue.getStats();

    return {
      timestamp: new Date(),
      tasksProcessed: this.processed,
      tasksFailed: this.failed,
      avgLatency: Math.round(avgLatency),
      p95Latency: Math.round(p95Latency),
      queueDepth: stats.pending,
      throughputPerMinute:
        elapsedMinutes > 0
          ? Math.round((this.processed / elapsedMinutes) * 100) / 100
          : 0,
      errorRate:
        this.processed > 0
          ? Math.round((this.failed / this.processed) * 10000) / 100
          : 0,
      activeWorkers: this.activeWorkers,
    };
  }

  reset(): void {
    this.processed = 0;
    this.failed = 0;
    this.latencies = [];
    this.startTime = Date.now();
    this.activeWorkers = 0;
  }

  getThroughput(): number {
    const elapsedMinutes = (Date.now() - this.startTime) / 60000;
    return elapsedMinutes > 0 ? this.processed / elapsedMinutes : 0;
  }

  getErrorRate(): number {
    return this.processed > 0 ? this.failed / this.processed : 0;
  }

  getAverageLatency(): number {
    if (this.latencies.length === 0) return 0;
    return this.latencies.reduce((sum, l) => sum + l, 0) / this.latencies.length;
  }
}
