import { describe, expect, it } from 'vitest';
import { expandOccurrences } from '@/server/calendar/recurrence';

const tz = 'America/New_York';
const D = (s: string) => new Date(s);

describe('expandOccurrences', () => {
  it('NONE returns the event when it overlaps the range', () => {
    const e = { id: 'e', startAt: D('2026-11-10T15:00:00Z'), endAt: D('2026-11-10T16:00:00Z'), recurrence: 'NONE' as const, recurrenceUntil: null };
    expect(expandOccurrences(e, D('2026-11-01T00:00:00Z'), D('2026-12-01T00:00:00Z'), tz)).toHaveLength(1);
    expect(expandOccurrences(e, D('2026-11-11T00:00:00Z'), D('2026-12-01T00:00:00Z'), tz)).toHaveLength(0);
  });

  it('WEEKLY steps 7 days and ids are eventId:startISO', () => {
    const e = { id: 'chess', startAt: D('2026-09-01T19:30:00Z'), endAt: D('2026-09-01T20:30:00Z'), recurrence: 'WEEKLY' as const, recurrenceUntil: '2026-09-29' };
    const occ = expandOccurrences(e, D('2026-09-01T00:00:00Z'), D('2026-12-01T00:00:00Z'), tz);
    expect(occ.map((o) => o.start.toISOString())).toEqual([
      '2026-09-01T19:30:00.000Z',
      '2026-09-08T19:30:00.000Z',
      '2026-09-15T19:30:00.000Z',
      '2026-09-22T19:30:00.000Z',
      '2026-09-29T19:30:00.000Z', // until is inclusive
    ]);
    expect(occ[1].id).toBe('chess:2026-09-08T19:30:00.000Z');
    expect(occ[1].eventId).toBe('chess');
  });

  it('keeps wall-clock time across the DST change (2026-11-01)', () => {
    // Tuesdays 15:30 New York: EDT (-4) then EST (-5)
    const e = { id: 'c', startAt: D('2026-10-27T19:30:00Z'), endAt: D('2026-10-27T20:30:00Z'), recurrence: 'WEEKLY' as const, recurrenceUntil: '2026-11-10' };
    const occ = expandOccurrences(e, D('2026-10-01T00:00:00Z'), D('2026-12-01T00:00:00Z'), tz);
    expect(occ.map((o) => o.start.toISOString())).toEqual(['2026-10-27T19:30:00.000Z', '2026-11-03T20:30:00.000Z', '2026-11-10T20:30:00.000Z']);
    expect(occ.every((o) => o.end.getTime() - o.start.getTime() === 3_600_000)).toBe(true);
  });

  it('MONTHLY on the 31st skips short months', () => {
    const e = { id: 'm', startAt: D('2027-01-31T14:00:00Z'), endAt: D('2027-01-31T15:00:00Z'), recurrence: 'MONTHLY' as const, recurrenceUntil: '2027-07-31' };
    const occ = expandOccurrences(e, D('2027-01-01T00:00:00Z'), D('2027-12-01T00:00:00Z'), tz);
    expect(occ.map((o) => o.start.toISOString().slice(0, 10))).toEqual(['2027-01-31', '2027-03-31', '2027-05-31', '2027-07-31']);
  });

  it('respects the range and the until bound', () => {
    const e = { id: 'w', startAt: D('2026-09-01T19:30:00Z'), endAt: D('2026-09-01T20:30:00Z'), recurrence: 'WEEKLY' as const, recurrenceUntil: D('2026-12-15T00:00:00Z') };
    const occ = expandOccurrences(e, D('2026-12-01T00:00:00Z'), D('2027-01-31T00:00:00Z'), tz);
    expect(occ.map((o) => o.start.toISOString().slice(0, 10))).toEqual(['2026-12-01', '2026-12-08', '2026-12-15']);
  });

  it('all-day weekly across DST keeps school-midnight bounds', () => {
    const e = { id: 'a', startAt: D('2026-10-25T04:00:00Z'), endAt: D('2026-10-26T04:00:00Z'), recurrence: 'WEEKLY' as const, recurrenceUntil: '2026-11-01' };
    const occ = expandOccurrences(e, D('2026-10-01T00:00:00Z'), D('2026-12-01T00:00:00Z'), tz);
    expect(occ[1].start.toISOString()).toBe('2026-11-01T04:00:00.000Z'); // 00:00 EDT on Nov 1
    expect(occ[1].end.toISOString()).toBe('2026-11-02T05:00:00.000Z'); // 00:00 EST on Nov 2
  });
});
