import { describe, expect, it, vi } from 'vitest';

// The lesson resolver touches the DB; the dispatch logic under test doesn't.
vi.mock('@/server/db', () => ({ prisma: {} }));
vi.mock('@/server/auth/course-access', () => ({ assertCanViewCourse: vi.fn() }));

import { canAccessFile, registerFileAccess } from '@/server/files/access';

const owner = { id: 'u1', role: 'TEACHER' };
const other = { id: 'u2', role: 'STUDENT' };
const admin = { id: 'a1', role: 'ADMIN' };
const file = (context: string, contextId: string | null) => ({ id: 'f1', ownerId: 'u1', context, contextId });

describe('canAccessFile dispatch (FR-9)', () => {
  it('unattached: owner or ADMIN only, never anonymous', async () => {
    const f = file('lesson', null);
    expect(await canAccessFile(owner, f)).toBe(true);
    expect(await canAccessFile(admin, f)).toBe(true);
    expect(await canAccessFile(other, f)).toBe(false);
    expect(await canAccessFile(null, f)).toBe(false);
  });

  it('registered context: delegates to the resolver', async () => {
    const resolver = vi.fn((user: { id: string } | null) => user?.id === 'u2');
    registerFileAccess('test-ctx', resolver);
    expect(await canAccessFile(other, file('test-ctx', 'x'))).toBe(true);
    expect(await canAccessFile(owner, file('test-ctx', 'x'))).toBe(false);
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it('a throwing resolver denies', async () => {
    registerFileAccess('boom', () => {
      throw new Error('db down');
    });
    expect(await canAccessFile(admin, file('boom', 'x'))).toBe(false);
  });

  it('unknown context: owner or ADMIN only', async () => {
    const f = file('assignment-not-registered', 'x');
    expect(await canAccessFile(owner, f)).toBe(true);
    expect(await canAccessFile(admin, f)).toBe(true);
    expect(await canAccessFile(other, f)).toBe(false);
    expect(await canAccessFile(null, f)).toBe(false);
  });

  it('logo is public, lesson denies anonymous', async () => {
    expect(await canAccessFile(null, file('logo', 'singleton'))).toBe(true);
    expect(await canAccessFile(null, file('lesson', 'l1'))).toBe(false);
  });
});
