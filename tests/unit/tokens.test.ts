import { describe, it, expect } from 'vitest';
import { hashToken } from '@/server/auth/tokens';

describe('hashToken', () => {
  it('is deterministic 64-char hex and never the raw token', () => {
    const raw = 'abc-raw-token';
    expect(hashToken(raw)).toBe(hashToken(raw));
    expect(hashToken(raw)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(raw)).not.toBe(raw);
    expect(hashToken('other')).not.toBe(hashToken(raw));
  });
});
