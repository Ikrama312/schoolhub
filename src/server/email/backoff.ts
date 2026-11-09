/** Retry schedule in minutes after attempts 1..5 (FR-18). Pure. */
export const BACKOFF_MIN = [1, 5, 15, 60, 240] as const;

export type RetryDecision = { status: 'PENDING'; nextAttemptAt: Date } | { status: 'FAILED' };

/**
 * `attempts` is the count *after* incrementing for the failed attempt.
 * Attempts 1..4 retry after BACKOFF_MIN[attempts-1]; attempt 5 fails permanently.
 */
export function nextRetry(attempts: number, now: Date = new Date()): RetryDecision {
  if (attempts >= BACKOFF_MIN.length) return { status: 'FAILED' };
  const minutes = BACKOFF_MIN[Math.max(0, attempts - 1)];
  return { status: 'PENDING', nextAttemptAt: new Date(now.getTime() + minutes * 60_000) };
}
