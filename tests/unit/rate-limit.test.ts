import { describe, it, expect, beforeEach } from 'vitest';
import { rateLimit, __resetRateLimits } from '@/server/rate-limit';
import { getClientIp } from '@/server/http';

describe('rateLimit', () => {
  beforeEach(() => __resetRateLimits());

  it('allows up to the limit then blocks with retryAfterMs', () => {
    for (let i = 0; i < 3; i += 1) expect(rateLimit('k', 3, 1000, 100 + i).ok).toBe(true);
    const blocked = rateLimit('k', 3, 1000, 500);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBe(600); // first hit at 100 expires at 1100
  });

  it('slides the window', () => {
    rateLimit('k', 2, 1000, 0);
    rateLimit('k', 2, 1000, 500);
    expect(rateLimit('k', 2, 1000, 999).ok).toBe(false);
    expect(rateLimit('k', 2, 1000, 1001).ok).toBe(true); // hit at 0 aged out
  });

  it('isolates keys', () => {
    rateLimit('a', 1, 1000, 0);
    expect(rateLimit('a', 1, 1000, 1).ok).toBe(false);
    expect(rateLimit('b', 1, 1000, 1).ok).toBe(true);
  });
});

describe('getClientIp', () => {
  it('takes the first x-forwarded-for entry, trimmed', () => {
    expect(getClientIp(new Request('http://x', { headers: { 'x-forwarded-for': ' 1.2.3.4 , 10.0.0.1' } }))).toBe('1.2.3.4');
  });

  it('returns null without the header', () => {
    expect(getClientIp(new Request('http://x'))).toBeNull();
  });
});
