import { describe, expect, it } from 'vitest';
import { nowAndNext, schoolNow } from '@/lib/dates';
import { periodsOverlap } from '@/server/timetable/clash-rules';
import { periodSchema, periodUpdateSchema } from '@/lib/validators/timetable';

const p = (startTime: string, endTime: string) => ({ startTime, endTime });

describe('periodsOverlap', () => {
  it('detects overlap and treats touching ends as free ([start, end))', () => {
    expect(periodsOverlap(p('08:00', '08:45'), p('08:30', '09:00'))).toBe(true);
    expect(periodsOverlap(p('08:00', '09:00'), p('08:10', '08:20'))).toBe(true);
    expect(periodsOverlap(p('08:00', '08:45'), p('08:45', '09:30'))).toBe(false);
    expect(periodsOverlap(p('09:35', '09:55'), p('08:00', '08:45'))).toBe(false);
  });
});

describe('periodSchema', () => {
  const base = { name: 'Period 1', kind: 'CLASS' as const };
  it('requires end after start and HH:MM format', () => {
    expect(periodSchema.safeParse({ ...base, startTime: '08:00', endTime: '08:45' }).success).toBe(true);
    expect(periodSchema.safeParse({ ...base, startTime: '08:45', endTime: '08:45' }).success).toBe(false);
    expect(periodSchema.safeParse({ ...base, startTime: '09:00', endTime: '08:00' }).success).toBe(false);
    expect(periodSchema.safeParse({ ...base, startTime: '8:00', endTime: '24:00' }).success).toBe(false);
  });
  it('partial update checks order only when both times are present', () => {
    expect(periodUpdateSchema.safeParse({ endTime: '07:00' }).success).toBe(true);
    expect(periodUpdateSchema.safeParse({ startTime: '10:00', endTime: '09:00' }).success).toBe(false);
  });
});

describe('schoolNow', () => {
  const instant = new Date('2026-11-04T17:30:00Z'); // Wednesday in UTC

  it('UTC', () => {
    expect(schoolNow(instant, 'UTC')).toEqual({ isoDay: 3, hhmm: '17:30' });
  });
  it('America/Los_Angeles', () => {
    expect(schoolNow(instant, 'America/Los_Angeles')).toEqual({ isoDay: 3, hhmm: '09:30' });
  });
  it('Asia/Kolkata', () => {
    expect(schoolNow(instant, 'Asia/Kolkata')).toEqual({ isoDay: 3, hhmm: '23:00' });
  });
  it('uses the school weekday when it differs from UTC (date line)', () => {
    const lateUtcSunday = new Date('2026-11-08T20:00:00Z'); // Sunday 20:00 UTC
    expect(schoolNow(lateUtcSunday, 'UTC').isoDay).toBe(7);
    expect(schoolNow(lateUtcSunday, 'Asia/Kolkata')).toEqual({ isoDay: 1, hhmm: '01:30' });
    const earlyUtcMonday = new Date('2026-11-09T03:00:00Z');
    expect(schoolNow(earlyUtcMonday, 'America/Los_Angeles')).toEqual({ isoDay: 7, hhmm: '19:00' });
  });
});

describe('nowAndNext', () => {
  const periods = [p('08:50', '09:35'), p('08:00', '08:45'), p('09:35', '09:55')];

  it('finds the running and the next period', () => {
    expect(nowAndNext(periods, '08:10')).toEqual({ now: p('08:00', '08:45'), next: p('08:50', '09:35') });
  });
  it('end is exclusive', () => {
    expect(nowAndNext(periods, '09:35')).toEqual({ now: p('09:35', '09:55'), next: null });
  });
  it('between periods and outside the day', () => {
    expect(nowAndNext(periods, '08:47')).toEqual({ now: null, next: p('08:50', '09:35') });
    expect(nowAndNext(periods, '07:00')).toEqual({ now: null, next: p('08:00', '08:45') });
    expect(nowAndNext(periods, '18:00')).toEqual({ now: null, next: null });
  });
});
