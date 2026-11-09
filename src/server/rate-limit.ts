// ponytail: per-process limiter, swap the Map for Redis/Postgres if horizontally scaled
const hits = new Map<string, number[]>();

/** Sliding-window limiter: allows `limit` calls per `windowMs` per key. */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): { ok: boolean; retryAfterMs: number } {
  const recent = (hits.get(key) ?? []).filter((t) => t > now - windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return { ok: false, retryAfterMs: recent[0] + windowMs - now };
  }
  recent.push(now);
  hits.set(key, recent);
  return { ok: true, retryAfterMs: 0 };
}

export function __resetRateLimits(): void {
  hits.clear();
}
