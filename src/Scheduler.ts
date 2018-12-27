import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { ScheduleEntry, TaskPriority } from './types';
import { TaskQueue } from './Queue';

interface ScheduleOptions {
  cron?: string;
  interval?: number;
  priority?: TaskPriority;
  group?: string;
}

export class Scheduler extends EventEmitter {
  private queue: TaskQueue;
  private entries: Map<string, ScheduleEntry> = new Map();
  private timers: Map<string, NodeJS.Timer> = new Map();
  private running: boolean = false;

  constructor(queue: TaskQueue) {
    super();
    this.queue = queue;
  }

  schedule(
    taskName: string,
    taskData: any,
    options: ScheduleOptions
  ): string {
    const id = uuidv4();
    const now = new Date();

    let nextRun: Date;
    if (options.interval) {
      nextRun = new Date(now.getTime() + options.interval);
    } else if (options.cron) {
      nextRun = this.parseCronNextRun(options.cron, now);
    } else {
      throw new Error('Either cron or interval must be specified');
    }

    const entry: ScheduleEntry = {
      id,
      taskName,
      taskData,
      cron: options.cron,
      interval: options.interval,
      nextRun,
      enabled: true,
    };

    this.entries.set(id, entry);

    if (this.running) {
      this.scheduleNext(entry, options);
    }

    this.emit('scheduled', entry);
    return id;
  }

  unschedule(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;

    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer as any);
      this.timers.delete(id);
    }

    this.entries.delete(id);
    this.emit('unscheduled', id);
    return true;
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    for (const entry of this.entries.values()) {
      if (entry.enabled) {
        this.scheduleNext(entry, {
          interval: entry.interval,
          cron: entry.cron,
        });
      }
    }

    this.emit('started');
  }

  stop(): void {
    this.running = false;
    for (const timer of this.timers.values()) {
      clearTimeout(timer as any);
    }
    this.timers.clear();
    this.emit('stopped');
  }

  getEntries(): ScheduleEntry[] {
    return Array.from(this.entries.values());
  }

  getEntry(id: string): ScheduleEntry | undefined {
    return this.entries.get(id);
  }

  private scheduleNext(entry: ScheduleEntry, options: ScheduleOptions): void {
    const now = Date.now();
    const delay = Math.max(0, entry.nextRun.getTime() - now);

    const timer = setTimeout(() => {
      if (!this.running || !entry.enabled) return;

      // Enqueue the task
      this.queue.enqueue(entry.taskName, entry.taskData, {
        priority: options.priority,
        group: options.group,
        meta: { scheduledEntryId: entry.id },
      });

      entry.lastRun = new Date();
      this.emit('triggered', entry);

      // Calculate and schedule next run
      if (options.interval) {
        entry.nextRun = new Date(Date.now() + options.interval);
      } else if (options.cron) {
        entry.nextRun = this.parseCronNextRun(options.cron, new Date());
      }

      this.scheduleNext(entry, options);
    }, delay);

    this.timers.set(entry.id, timer);
  }

  /**
   * Simplified cron parser supporting: minute hour day month weekday
   * Supports numeric values and wildcards (*).
   * Returns the next Date after `after` that matches the pattern.
   */
  private parseCronNextRun(cron: string, after: Date): Date {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) {
      throw new Error(`Invalid cron expression: "${cron}" (expected 5 fields)`);
    }

    const [minSpec, hourSpec, daySpec, monthSpec, dowSpec] = parts;
    const candidate = new Date(after.getTime() + 60000); // start checking from next minute
    candidate.setSeconds(0, 0);

    // Brute-force search over the next 366 days
    for (let i = 0; i < 527040; i++) {
      const min = candidate.getMinutes();
      const hour = candidate.getHours();
      const day = candidate.getDate();
      const month = candidate.getMonth() + 1;
      const dow = candidate.getDay();

      if (
        this.matchField(minSpec, min) &&
        this.matchField(hourSpec, hour) &&
        this.matchField(daySpec, day) &&
        this.matchField(monthSpec, month) &&
        this.matchField(dowSpec, dow)
      ) {
        return candidate;
      }

      candidate.setTime(candidate.getTime() + 60000);
    }

    // Fallback: 24 hours from now
    return new Date(after.getTime() + 86400000);
  }

  private matchField(spec: string, value: number): boolean {
    if (spec === '*') return true;

    // Handle step values like */5
    if (spec.startsWith('*/')) {
      const step = parseInt(spec.slice(2), 10);
      return value % step === 0;
    }

    // Handle comma-separated values like 1,15,30
    const values = spec.split(',').map((v) => parseInt(v, 10));
    return values.includes(value);
  }
}
