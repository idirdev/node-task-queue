import { Middleware, Task, TaskResult } from '../types';

export interface LoggingOptions {
  prefix?: string;
  logTimestamp?: boolean;
  logData?: boolean;
  logResult?: boolean;
  logger?: (message: string) => void;
}

export function createLoggingMiddleware(options: LoggingOptions = {}): Middleware {
  const {
    prefix = '[TaskQueue]',
    logTimestamp = true,
    logData = false,
    logResult = false,
    logger = console.log,
  } = options;

  function formatMessage(message: string): string {
    if (logTimestamp) {
      const ts = new Date().toISOString();
      return `${prefix} ${ts} ${message}`;
    }
    return `${prefix} ${message}`;
  }

  return {
    beforeProcess(task: Task): void {
      let msg = `START task="${task.name}" id=${task.id} priority=${task.priority} attempt=${task.attempts + 1}`;
      if (task.group) {
        msg += ` group="${task.group}"`;
      }
      if (logData) {
        msg += ` data=${JSON.stringify(task.data)}`;
      }
      logger(formatMessage(msg));
    },

    afterProcess(task: Task, result: TaskResult): void {
      const status = result.success ? 'COMPLETE' : 'FAILED';
      let msg = `${status} task="${task.name}" id=${task.id} duration=${result.duration}ms attempts=${result.attempts}`;
      if (result.error) {
        msg += ` error="${result.error}"`;
      }
      if (logResult && result.result !== undefined) {
        msg += ` result=${JSON.stringify(result.result)}`;
      }
      logger(formatMessage(msg));
    },

    onError(task: Task, error: Error): void {
      const msg = `ERROR task="${task.name}" id=${task.id} error="${error.message}"`;
      logger(formatMessage(msg));
    },
  };
}
