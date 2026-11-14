import { describe, expect, it, vi } from 'vitest';

// notify.ts → render.ts → env.ts validates at import; give it the required vars first.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.AUTH_SECRET ??= 'test-secret';
});

import { resolvePrefs } from '@/server/notifications/preferences';
import { expandStudentRecipients } from '@/server/notifications/notify';
import { nextRetry, BACKOFF_MIN } from '@/server/email/backoff';
import { isSafeRelativeLink } from '@/lib/validators/notifications';
import { visibleTypesFor, typesInCategory } from '@/server/notifications/types';

describe('resolvePrefs', () => {
  const optional = { mandatoryInApp: false, defaultEmail: true };
  const mandatory = { mandatoryInApp: true, defaultEmail: false };

  it('uses registry defaults when there is no row', () => {
    expect(resolvePrefs(optional)).toEqual({ inApp: true, email: true });
    expect(resolvePrefs(mandatory)).toEqual({ inApp: true, email: false });
  });

  it('applies the row overrides', () => {
    expect(resolvePrefs(optional, { inApp: false, email: false })).toEqual({ inApp: false, email: false });
    expect(resolvePrefs(mandatory, { inApp: true, email: true })).toEqual({ inApp: true, email: true });
  });

  it('never lets a row disable a mandatory in-app type', () => {
    expect(resolvePrefs(mandatory, { inApp: false, email: false }).inApp).toBe(true);
  });
});

describe('nextRetry', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const minutesAfter = (d: Date) => (d.getTime() - now.getTime()) / 60_000;

  it('backs off 1, 5, 15, 60 minutes for failures 1-4', () => {
    for (const [i, expected] of [1, 5, 15, 60].entries()) {
      const r = nextRetry(i + 1, now);
      expect(r.status).toBe('PENDING');
      if (r.status === 'PENDING') expect(minutesAfter(r.nextAttemptAt)).toBe(expected);
    }
  });

  it('marks FAILED after the 5th failure', () => {
    expect(nextRetry(5, now)).toEqual({ status: 'FAILED' });
    expect(nextRetry(6, now)).toEqual({ status: 'FAILED' });
  });

  it('exposes the PRD schedule', () => {
    expect(BACKOFF_MIN).toEqual([1, 5, 15, 60, 240]);
  });
});

describe('isSafeRelativeLink', () => {
  it.each(['/dashboard', '/notifications?page=2', '/courses/abc#roster', '/'])('accepts %s', (link) => {
    expect(isSafeRelativeLink(link)).toBe(true);
  });

  it.each([
    '//evil.com',
    '/\\evil.com',
    '/foo\\bar',
    'http://x',
    'https://evil.com/dashboard',
    'javascript:alert(1)',
    'dashboard',
    '',
    '/foo\nbar',
    '/foo\u0000',
    '/\tevil',
    '/foo\u007f',
  ])('rejects %j', (link) => {
    expect(isSafeRelativeLink(link)).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isSafeRelativeLink(undefined)).toBe(false);
    expect(isSafeRelativeLink(42)).toBe(false);
  });
});

describe('expandStudentRecipients', () => {
  it('adds linked parents and dedupes', () => {
    const ids = expandStudentRecipients(
      ['s1', 's2', 's1'],
      [
        { studentId: 's1', parentId: 'p1' },
        { studentId: 's2', parentId: 'p1' },
        { studentId: 's2', parentId: 'p2' },
      ],
    );
    expect(ids.sort()).toEqual(['p1', 'p2', 's1', 's2']);
  });

  it('ignores links for students not in the list', () => {
    expect(expandStudentRecipients(['s1'], [{ studentId: 's9', parentId: 'p9' }])).toEqual(['s1']);
  });

  it('returns students only when nobody is linked', () => {
    expect(expandStudentRecipients(['s1'], [])).toEqual(['s1']);
  });
});

describe('registry helpers', () => {
  it('hides emailOnly types from preferences', () => {
    const visible = visibleTypesFor('STUDENT');
    expect(visible).toContain('system.test');
    expect(visible).not.toContain('account.invite');
    expect(visible).not.toContain('account.password_reset');
  });

  it('groups types by category', () => {
    expect(typesInCategory('SYSTEM')).toEqual(['system.test']);
    expect(typesInCategory('FINANCE')).toEqual(['fees.invoice_issued', 'fees.payment_received', 'fees.overdue_reminder']); // PRD-17 FR-36
  });
});
