import { describe, expect, it } from 'vitest';
import ical from 'node-ical';
import { NOTIFICATION_TYPES } from '@/server/notifications/types';
import { expandOccurrences } from '@/server/calendar/recurrence';
import { buildCalendar, foldLine } from '@/server/calendar/ical';
import { eventInputSchema } from '@/lib/validators/calendar';

/** SH-14 QA: edge cases not in the Dev unit tests. */
const tz = 'America/New_York';
const D = (s: string) => new Date(s);

describe('FR-23/28/29 notification types', () => {
  it('registers event.* types with the planned email defaults', () => {
    expect(NOTIFICATION_TYPES['event.created'].defaultEmail).toBe(false);
    expect(NOTIFICATION_TYPES['event.holiday_created'].defaultEmail).toBe(true);
    expect(NOTIFICATION_TYPES['event.updated'].defaultEmail).toBe(false);
    expect(NOTIFICATION_TYPES['event.rsvp_reminder'].defaultEmail).toBe(false);
    for (const t of ['event.created', 'event.holiday_created', 'event.updated', 'event.rsvp_reminder'] as const) {
      expect(NOTIFICATION_TYPES[t].roles).toEqual(expect.arrayContaining(['ADMIN', 'TEACHER', 'STUDENT', 'PARENT']));
    }
  });
});

describe('FR-15 expandOccurrences edge cases', () => {
  it('includes an occurrence already in progress at the range start', () => {
    const e = { id: 'w', startAt: D('2026-11-03T14:00:00Z'), endAt: D('2026-11-03T18:00:00Z'), recurrence: 'WEEKLY' as const, recurrenceUntil: '2026-11-17' };
    const occ = expandOccurrences(e, D('2026-11-10T16:00:00Z'), D('2026-11-11T00:00:00Z'), tz);
    expect(occ.map((o) => o.start.toISOString())).toEqual(['2026-11-10T14:00:00.000Z']);
  });

  it('returns nothing when the range ends before the first occurrence', () => {
    const e = { id: 'w', startAt: D('2026-11-03T14:00:00Z'), endAt: D('2026-11-03T15:00:00Z'), recurrence: 'MONTHLY' as const, recurrenceUntil: '2027-06-03' };
    expect(expandOccurrences(e, D('2026-10-01T00:00:00Z'), D('2026-11-01T00:00:00Z'), tz)).toEqual([]);
  });

  it('a one-year weekly series yields ≤ 53 occurrences (no runaway loop)', () => {
    const e = { id: 'y', startAt: D('2026-09-01T19:30:00Z'), endAt: D('2026-09-01T20:30:00Z'), recurrence: 'WEEKLY' as const, recurrenceUntil: '2027-09-01' };
    const occ = expandOccurrences(e, D('2026-09-01T00:00:00Z'), D('2027-09-02T00:00:00Z'), tz);
    expect(occ.length).toBe(53);
  });
});

describe('FR-26/NFR-6 iCal edge cases', () => {
  it('a line of exactly 75 octets is not folded', () => {
    const line = 'X'.repeat(75);
    expect(foldLine(line)).toBe(line);
    expect(foldLine(`${line}Y`).split('\r\n')).toEqual([line, ' Y']);
  });

  it('a feed with no items still parses (VCALENDAR + VTIMEZONE only)', () => {
    const body = buildCalendar([], tz, { from: D('2026-10-01T00:00:00Z'), to: D('2027-10-01T00:00:00Z') });
    const parsed = ical.sync.parseICS(body);
    expect(Object.values(parsed).some((c) => c?.type === 'VEVENT')).toBe(false);
    expect(body).toMatch(/BEGIN:DAYLIGHT[\s\S]*TZOFFSETTO:-0400/);
    expect(body).toMatch(/BEGIN:STANDARD[\s\S]*TZOFFSETTO:-0500/);
  });

  it('a timezone without DST gets a single STANDARD block', () => {
    const body = buildCalendar([], 'Asia/Tokyo', { from: D('2026-10-01T00:00:00Z'), to: D('2027-10-01T00:00:00Z') });
    expect(body).toContain('TZOFFSETFROM:+0900');
    expect(body).not.toContain('BEGIN:DAYLIGHT');
  });
});

describe('FR-4 validator edge cases', () => {
  const base = {
    title: 'Fair',
    category: 'EVENT',
    startAt: '2026-11-20T14:00:00Z',
    endAt: '2026-11-20T17:00:00Z',
    audiences: [{ type: 'SCHOOL', refId: null }],
  };
  it('title of exactly 150 chars passes, 151 fails; whitespace-only title fails', () => {
    expect(eventInputSchema.safeParse({ ...base, title: 'x'.repeat(150) }).success).toBe(true);
    expect(eventInputSchema.safeParse({ ...base, title: 'x'.repeat(151) }).success).toBe(false);
    expect(eventInputSchema.safeParse({ ...base, title: '   ' }).success).toBe(false);
  });
  it('zero-length timed event (endAt = startAt) is allowed (endAt ≥ startAt)', () => {
    expect(eventInputSchema.safeParse({ ...base, endAt: base.startAt }).success).toBe(true);
  });
  it('isNoSchool has no schema default — the category default (FR-5) must come from the service', () => {
    const parsed = eventInputSchema.parse({ ...base, category: 'HOLIDAY' });
    expect(parsed.isNoSchool).toBeUndefined();
  });
});
