import { describe, it, expect } from 'vitest';
import { computeLockout } from '@/server/auth/credentials';

describe('computeLockout', () => {
  const now = new Date('2026-11-04T12:00:00Z');

  it('keeps counting below 5 failures', () => {
    expect(computeLockout(1, now)).toEqual({ failedLoginCount: 1, lockedUntil: null });
    expect(computeLockout(4, now)).toEqual({ failedLoginCount: 4, lockedUntil: null });
  });

  it('locks for 15 minutes and resets the count at 5', () => {
    expect(computeLockout(5, now)).toEqual({
      failedLoginCount: 0,
      lockedUntil: new Date('2026-11-04T12:15:00Z'),
    });
  });

  it('also locks if the count overshoots', () => {
    expect(computeLockout(6, now).lockedUntil).not.toBeNull();
  });
});
