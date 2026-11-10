import { describe, expect, it } from 'vitest';
import { addDateDays, formatInSchoolTz, nextTeachingDayDueAt, schoolDateOf, schoolMidnight } from '@/lib/dates';

describe('formatInSchoolTz', () => {
  const utcDate = '2024-01-15T17:30:00.000Z';

  it('formats a UTC ISO string in the given timezone', () => {
    expect(formatInSchoolTz(utcDate, 'yyyy-MM-dd HH:mm', 'America/New_York')).toBe('2024-01-15 12:30');
  });

  it('formats a Date object the same way as an equivalent ISO string', () => {
    const asDate = new Date(utcDate);
    expect(formatInSchoolTz(asDate, 'yyyy-MM-dd HH:mm', 'America/New_York')).toBe(
      formatInSchoolTz(utcDate, 'yyyy-MM-dd HH:mm', 'America/New_York'),
    );
  });

  it('produces a different wall-clock time for a different timezone', () => {
    const inTokyo = formatInSchoolTz(utcDate, 'yyyy-MM-dd HH:mm', 'Asia/Tokyo');
    const inNewYork = formatInSchoolTz(utcDate, 'yyyy-MM-dd HH:mm', 'America/New_York');
    expect(inTokyo).not.toBe(inNewYork);
    expect(inTokyo).toBe('2024-01-16 02:30');
  });

  it('respects the given date-fns pattern', () => {
    expect(formatInSchoolTz(utcDate, 'MMM d, yyyy', 'UTC')).toBe('Jan 15, 2024');
  });
});

describe('nextTeachingDayDueAt (FR-10, NFR-9)', () => {
  const WEEKDAYS = [1, 2, 3, 4, 5];
  const local = (d: Date, tz: string) => formatInSchoolTz(d, 'EEE yyyy-MM-dd HH:mm', tz);

  it('Mon → Tue 23:59 local', () => {
    expect(local(nextTeachingDayDueAt(new Date('2026-09-14T09:00:00Z'), 'Europe/London', WEEKDAYS), 'Europe/London')).toBe(
      'Tue 2026-09-15 23:59',
    );
  });

  it('Fri → skips the weekend to Mon', () => {
    expect(local(nextTeachingDayDueAt(new Date('2026-09-18T09:00:00Z'), 'Europe/London', WEEKDAYS), 'Europe/London')).toBe(
      'Mon 2026-09-21 23:59',
    );
  });

  it('uses the school day, not the UTC day (late evening in Tokyo is already tomorrow)', () => {
    // 2026-09-17T16:00Z = Fri 01:00 in Tokyo → next teaching day is Mon.
    expect(local(nextTeachingDayDueAt(new Date('2026-09-17T16:00:00Z'), 'Asia/Tokyo', WEEKDAYS), 'Asia/Tokyo')).toBe(
      'Mon 2026-09-21 23:59',
    );
  });

  it('is 23:59 local on both sides of a DST change (Europe/London)', () => {
    const beforeSpring = nextTeachingDayDueAt(new Date('2026-03-27T09:00:00Z'), 'Europe/London', WEEKDAYS);
    expect(beforeSpring.toISOString()).toBe('2026-03-30T22:59:00.000Z'); // BST: UTC+1
    const beforeFall = nextTeachingDayDueAt(new Date('2026-10-23T09:00:00Z'), 'Europe/London', WEEKDAYS);
    expect(beforeFall.toISOString()).toBe('2026-10-26T23:59:00.000Z'); // GMT: UTC+0
  });

  it('falls back to tomorrow when no day is teaching', () => {
    expect(local(nextTeachingDayDueAt(new Date('2026-09-18T09:00:00Z'), 'UTC', []), 'UTC')).toBe('Sat 2026-09-19 23:59');
  });
});

describe('schoolMidnight / schoolDateOf (PRD-14 all-day conversion)', () => {
  const tz = 'America/New_York';

  it('maps a date to school-local midnight in UTC', () => {
    expect(schoolMidnight('2026-11-10', tz).toISOString()).toBe('2026-11-10T05:00:00.000Z');
    expect(schoolMidnight('2026-07-10', tz).toISOString()).toBe('2026-07-10T04:00:00.000Z');
  });

  it('all-day across the DST change (2026-11-01) keeps an exclusive next-midnight end', () => {
    // Inclusive 2026-10-31..2026-11-01 → [Oct 31 00:00 EDT, Nov 2 00:00 EST)
    const start = schoolMidnight('2026-10-31', tz);
    const end = schoolMidnight(addDateDays('2026-11-01', 1), tz);
    expect(start.toISOString()).toBe('2026-10-31T04:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-02T05:00:00.000Z');
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(49); // 25h day included
    expect(schoolDateOf(start, tz)).toBe('2026-10-31');
    expect(schoolDateOf(new Date(end.getTime() - 1), tz)).toBe('2026-11-01');
  });

  it('schoolDateOf uses the school timezone, not UTC', () => {
    expect(schoolDateOf('2026-11-11T03:00:00Z', tz)).toBe('2026-11-10');
  });

  it('addDateDays crosses month and year ends', () => {
    expect(addDateDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDateDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
