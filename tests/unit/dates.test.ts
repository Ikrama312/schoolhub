import { describe, expect, it } from 'vitest';
import { formatInSchoolTz, nextTeachingDayDueAt } from '@/lib/dates';

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
