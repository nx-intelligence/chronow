/**
 * Get current Unix timestamp in milliseconds
 */
export function nowMs(): number {
  return Date.now();
}

/**
 * Get current Unix timestamp in seconds
 */
export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Convert milliseconds to seconds
 */
export function msToSec(ms: number): number {
  return Math.floor(ms / 1000);
}

/**
 * Convert seconds to milliseconds
 */
export function secToMs(sec: number): number {
  return sec * 1000;
}

/**
 * Calculate backoff delay using exponential strategy with jitter
 */
export function calculateBackoff(
  attempt: number,
  backoffMs: number[],
  jitter: boolean = true
): number {
  const idx = Math.min(attempt, backoffMs.length - 1);
  const baseDelay = backoffMs[idx] || backoffMs[backoffMs.length - 1] || 1000;
  
  if (jitter) {
    // Add up to 20% jitter
    const jitterAmount = baseDelay * 0.2;
    return baseDelay + Math.random() * jitterAmount;
  }
  
  return baseDelay;
}

