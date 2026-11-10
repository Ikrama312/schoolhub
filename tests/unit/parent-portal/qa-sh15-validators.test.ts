// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

/**
 * QA SH-15: FR-2 validation rules, FR-22 reject-needs-note, FR-18 date window,
 * FR-37 signature rule, and FR-4 sh_child fallback (unlinked cookie → first child).
 */
const cookie = vi.hoisted(() => ({ value: undefined as string | undefined }));
// React 18 only exports cache() under the react-server condition; identity is enough here.
vi.mock('react', async (orig) => ({ ...(await orig<object>()), cache: <T>(fn: T) => fn }));
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => (cookie.value ? { value: cookie.value } : undefined) }) }));
vi.mock('@/server/db', () => ({
  prisma: {
    parentStudentLink: {
      findMany: async () => [
        { student: { id: 'kid-a', firstName: 'Ann', lastName: 'X' } },
        { student: { id: 'kid-b', firstName: 'Ben', lastName: 'X' } },
      ],
    },
  },
}));

import { absenceNoteInputSchema, absenceNoteSchemaFor, reviewSchema } from '@/lib/validators/absence-notes';
import { availabilitySchema, bookingSchema, conferenceEventInputSchema } from '@/lib/validators/conferences';
import { consentResponseSchema } from '@/lib/validators/consent-forms';
import { signatureMatches } from '@/server/consent-forms/signature';
import { getSelectedChild } from '@/server/parent/selected-child';

const note = { studentId: 's', fromDate: '2026-11-10', toDate: '2026-11-10', reason: 'ILLNESS' as const };
const ok = (r: { success: boolean }) => r.success;

describe('FR-2 absence note rules', () => {
  it('toDate must be >= fromDate', () => {
    expect(ok(absenceNoteInputSchema.safeParse({ ...note, toDate: '2026-11-09' }))).toBe(false);
  });
  it('span <= 30 days', () => {
    expect(ok(absenceNoteInputSchema.safeParse({ ...note, toDate: '2026-12-10' }))).toBe(true); // 30 days
    expect(ok(absenceNoteInputSchema.safeParse({ ...note, toDate: '2026-12-11' }))).toBe(false); // 31 days
  });
  it('details <= 1000 chars', () => {
    expect(ok(absenceNoteInputSchema.safeParse({ ...note, details: 'x'.repeat(1000) }))).toBe(true);
    expect(ok(absenceNoteInputSchema.safeParse({ ...note, details: 'x'.repeat(1001) }))).toBe(false);
  });
  it('periodIds only with partialDay, and required with it', () => {
    expect(ok(absenceNoteInputSchema.safeParse({ ...note, periodIds: ['p1'] }))).toBe(false);
    expect(ok(absenceNoteInputSchema.safeParse({ ...note, partialDay: true }))).toBe(false);
    expect(ok(absenceNoteInputSchema.safeParse({ ...note, partialDay: true, periodIds: ['p1'] }))).toBe(true);
  });
  it('FR-18 window: past 14 days to 60 days ahead', () => {
    const s = absenceNoteSchemaFor('2026-11-10');
    expect(ok(s.safeParse({ ...note, fromDate: '2026-10-27', toDate: '2026-10-27' }))).toBe(true);
    expect(ok(s.safeParse({ ...note, fromDate: '2026-10-26', toDate: '2026-10-26' }))).toBe(false);
    expect(ok(s.safeParse({ ...note, fromDate: '2027-01-09', toDate: '2027-01-09' }))).toBe(true);
    expect(ok(s.safeParse({ ...note, fromDate: '2027-01-10', toDate: '2027-01-10' }))).toBe(false);
  });
});

describe('FR-22 review', () => {
  it('reject requires a note, approve does not', () => {
    expect(ok(reviewSchema.safeParse({ decision: 'REJECTED' }))).toBe(false);
    expect(ok(reviewSchema.safeParse({ decision: 'REJECTED', reviewNote: 'No evidence' }))).toBe(true);
    expect(ok(reviewSchema.safeParse({ decision: 'APPROVED' }))).toBe(true);
  });
});

describe('FR-2 conference rules', () => {
  const ev = { title: 'C', date: '2026-12-01', bookingOpensAt: '2026-11-11T00:00:00Z', bookingClosesAt: '2026-11-30T00:00:00Z', gradeLevelIds: ['g'] };
  it('slotMinutes 5–60', () => {
    for (const [m, want] of [[4, false], [5, true], [60, true], [61, false]] as const) {
      expect(ok(conferenceEventInputSchema.safeParse({ ...ev, slotMinutes: m }))).toBe(want);
    }
  });
  it('booking must close after it opens', () => {
    expect(ok(conferenceEventInputSchema.safeParse({ ...ev, slotMinutes: 10, bookingClosesAt: ev.bookingOpensAt }))).toBe(false);
  });
  it('parentNote <= 500 chars', () => {
    expect(ok(bookingSchema.safeParse({ studentId: 's', parentNote: 'x'.repeat(500) }))).toBe(true);
    expect(ok(bookingSchema.safeParse({ studentId: 's', parentNote: 'x'.repeat(501) }))).toBe(false);
  });
  it('availability ranges use HH:mm', () => {
    expect(ok(availabilitySchema.safeParse({ ranges: [{ start: '15:00', end: '17:00' }] }))).toBe(true);
    expect(ok(availabilitySchema.safeParse({ ranges: [{ start: '25:00', end: '17:00' }] }))).toBe(false);
  });
});

describe('FR-37 consent response', () => {
  it('requires Granted/Declined and a signature', () => {
    expect(ok(consentResponseSchema.safeParse({ studentId: 's', value: 'MAYBE', signature: 'A B' }))).toBe(false);
    expect(ok(consentResponseSchema.safeParse({ studentId: 's', value: 'GRANTED', signature: '  ' }))).toBe(false);
  });
  it('signature matches full name case-insensitively, not a different name', () => {
    expect(signatureMatches('  jane   DOE ', 'Jane Doe')).toBe(true);
    expect(signatureMatches('Jane', 'Jane Doe')).toBe(false);
  });
});

describe('FR-4 sh_child fallback', () => {
  const parent = { id: 'p', role: 'PARENT' as const };
  it('honours a linked cookie', async () => {
    cookie.value = 'kid-b';
    expect((await getSelectedChild(parent))?.studentId).toBe('kid-b');
  });
  it('unlinked cookie falls back to the first child', async () => {
    cookie.value = 'someone-else';
    expect((await getSelectedChild(parent))?.studentId).toBe('kid-a');
  });
  it('?studentId= overrides the cookie (FR-5)', async () => {
    cookie.value = 'kid-a';
    expect((await getSelectedChild(parent, { studentId: 'kid-b' }))?.studentId).toBe('kid-b');
  });
  it('non-parents get null', async () => {
    expect(await getSelectedChild({ id: 't', role: 'TEACHER' })).toBeNull();
  });
});
