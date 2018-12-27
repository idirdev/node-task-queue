import { RetryPolicy } from '../types';

/**
 * Calculate the delay before the next retry attempt based on the retry policy.
 *
 * @param attempt - Current attempt number (0-indexed, so first retry is attempt 0)
 * @param policy - The retry policy configuration
 * @returns Delay in milliseconds
 */
export function calculateDelay(attempt: number, policy: RetryPolicy): number {
  let delay: number;

  switch (policy.strategy) {
    case 'fixed':
      delay = policy.baseDelay;
      break;

    case 'linear':
      // Linear backoff: baseDelay * (attempt + 1)
      delay = policy.baseDelay * (attempt + 1);
      break;

    case 'exponential':
      // Exponential backoff: baseDelay * 2^attempt
      delay = policy.baseDelay * Math.pow(2, attempt);
      break;

    default:
      delay = policy.baseDelay;
  }

  // Apply jitter to prevent thundering herd
  if (policy.jitter) {
    delay = addJitter(delay);
  }

  // Clamp to maxDelay
  return Math.min(delay, policy.maxDelay);
}

/**
 * Add random jitter to a delay value.
 * Uses "full jitter" strategy: random value between 0 and delay.
 */
function addJitter(delay: number): number {
  return Math.floor(Math.random() * delay);
}

/**
 * Create a default retry policy with optional overrides.
 */
export function createRetryPolicy(overrides: Partial<RetryPolicy> = {}): RetryPolicy {
  return {
    maxRetries: 3,
    strategy: 'exponential',
    baseDelay: 1000,
    maxDelay: 30000,
    jitter: true,
    ...overrides,
  };
}

/**
 * Determine whether a given error is retryable.
 * By default, all errors are retryable unless they match known non-retryable patterns.
 */
export function isRetryableError(error: Error): boolean {
  const nonRetryable = [
    'INVALID_ARGUMENT',
    'VALIDATION_ERROR',
    'UNAUTHORIZED',
    'FORBIDDEN',
    'NOT_FOUND',
  ];

  const message = error.message.toUpperCase();
  return !nonRetryable.some((code) => message.includes(code));
}
