import { Task, TaskStatus } from './types';
import { TaskQueue } from './Queue';

export interface StoreSnapshot {
  version: number;
  exportedAt: string;
  tasks: Task[];
}

export class TaskStore {
  private archive: Map<string, Task> = new Map();
  private queue: TaskQueue;
  private cleanupInterval: NodeJS.Timer | null = null;

  constructor(queue: TaskQueue) {
    this.queue = queue;

    // Listen for completed and failed tasks to archive them
    this.queue.on('completed', (task: Task) => this.archiveTask(task));
    this.queue.on('failed', (task: Task) => this.archiveTask(task));
    this.queue.on('cancelled', (task: Task) => this.archiveTask(task));
  }

  private archiveTask(task: Task): void {
    this.archive.set(task.id, { ...task });
  }

  findById(id: string): Task | undefined {
    // Check the live queue first
    const liveTask = this.queue.findById(id);
    if (liveTask) return liveTask;

    // Then check the archive
    return this.archive.get(id);
  }

  findByStatus(status: TaskStatus): Task[] {
    const live = this.queue.findByStatus(status);
    const archived = Array.from(this.archive.values()).filter(
      (t) => t.status === status
    );
    return [...live, ...archived];
  }

  findByGroup(group: string): Task[] {
    const live = this.queue.findByGroup(group);
    const archived = Array.from(this.archive.values()).filter(
      (t) => t.group === group
    );
    return [...live, ...archived];
  }

  findByName(name: string): Task[] {
    const archived = Array.from(this.archive.values()).filter(
      (t) => t.name === name
    );
    const live = this.queue
      .findByStatus('queued')
      .concat(this.queue.findByStatus('running'))
      .concat(this.queue.findByStatus('pending'))
      .filter((t) => t.name === name);
    return [...live, ...archived];
  }

  getArchivedCount(): number {
    return this.archive.size;
  }

  /**
   * Remove completed/failed tasks older than maxAge (milliseconds).
   */
  cleanupCompleted(maxAge: number): number {
    const cutoff = Date.now() - maxAge;
    let removed = 0;

    for (const [id, task] of this.archive.entries()) {
      if (
        task.completedAt &&
        task.completedAt.getTime() < cutoff &&
        (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled')
      ) {
        this.archive.delete(id);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Start automatic cleanup on an interval.
   */
  startAutoCleanup(intervalMs: number, maxAge: number): void {
    this.stopAutoCleanup();
    this.cleanupInterval = setInterval(() => {
      this.cleanupCompleted(maxAge);
    }, intervalMs);
  }

  stopAutoCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval as any);
      this.cleanupInterval = null;
    }
  }

  /**
   * Export all known tasks (live + archived) as a serializable snapshot.
   */
  export(): StoreSnapshot {
    const liveTasks = ['pending', 'queued', 'running', 'retrying', 'paused']
      .flatMap((status) => this.queue.findByStatus(status as TaskStatus));

    const archivedTasks = Array.from(this.archive.values());

    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      tasks: [...liveTasks, ...archivedTasks],
    };
  }

  /**
   * Import tasks from a snapshot into the archive (does not re-enqueue).
   */
  import(snapshot: StoreSnapshot): number {
    let imported = 0;
    for (const task of snapshot.tasks) {
      if (!this.archive.has(task.id)) {
        this.archive.set(task.id, {
          ...task,
          createdAt: new Date(task.createdAt),
          startedAt: task.startedAt ? new Date(task.startedAt) : undefined,
          completedAt: task.completedAt ? new Date(task.completedAt) : undefined,
          scheduledFor: task.scheduledFor ? new Date(task.scheduledFor) : undefined,
        });
        imported++;
      }
    }
    return imported;
  }
}
