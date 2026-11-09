import { describe, expect, it, vi } from 'vitest';

vi.mock('@/server/db', () => ({ prisma: {} }));

import { isInQuietHours, quietHoursEnd } from '@/server/messaging/quiet-hours';

describe('isInQuietHours', () => {
  it('handles a same-day range [start, end)', () => {
    expect(isInQuietHours('12:59', '13:00', '14:00')).toBe(false);
    expect(isInQuietHours('13:00', '13:00', '14:00')).toBe(true);
    expect(isInQuietHours('13:59', '13:00', '14:00')).toBe(true);
    expect(isInQuietHours('14:00', '13:00', '14:00')).toBe(false);
  });

  it('handles a range that wraps midnight', () => {
    expect(isInQuietHours('21:59', '22:00', '07:00')).toBe(false);
    expect(isInQuietHours('22:00', '22:00', '07:00')).toBe(true);
    expect(isInQuietHours('23:59', '22:00', '07:00')).toBe(true);
    expect(isInQuietHours('00:00', '22:00', '07:00')).toBe(true);
    expect(isInQuietHours('06:59', '22:00', '07:00')).toBe(true);
    expect(isInQuietHours('07:00', '22:00', '07:00')).toBe(false);
  });

  it('start === end is never quiet', () => {
    expect(isInQuietHours('10:00', '10:00', '10:00')).toBe(false);
  });
});

describe('quietHoursEnd', () => {
  const night = { quietStart: '22:00', quietEnd: '07:00' };

  it('returns null outside quiet hours or with none set', () => {
    expect(quietHoursEnd(new Date('2026-03-10T12:00:00Z'), 'UTC', night)).toBeNull();
    expect(quietHoursEnd(new Date('2026-03-10T23:00:00Z'), 'UTC', { quietStart: null, quietEnd: null })).toBeNull();
    expect(quietHoursEnd(new Date('2026-03-10T23:00:00Z'), 'UTC', null)).toBeNull();
  });

  it('before midnight → end is tomorrow', () => {
    expect(quietHoursEnd(new Date('2026-03-10T23:00:00Z'), 'UTC', night)?.toISOString()).toBe('2026-03-11T07:00:00.000Z');
  });

  it('after midnight → end is today', () => {
    expect(quietHoursEnd(new Date('2026-03-11T03:00:00Z'), 'UTC', night)?.toISOString()).toBe('2026-03-11T07:00:00.000Z');
  });

  it('uses the school timezone, not UTC', () => {
    // 23:30 in New York (EST, UTC-5) = 04:30Z next day; ends 07:00 local = 12:00Z.
    expect(quietHoursEnd(new Date('2026-01-16T04:30:00Z'), 'America/New_York', night)?.toISOString()).toBe('2026-01-16T12:00:00.000Z');
  });

  it('is DST-correct across the spring-forward night', () => {
    // US DST starts 2026-03-08 02:00 local. 23:00 EST on 03-07 = 04:00Z; 07:00 EDT on 03-08 = 11:00Z.
    expect(quietHoursEnd(new Date('2026-03-08T04:00:00Z'), 'America/New_York', night)?.toISOString()).toBe('2026-03-08T11:00:00.000Z');
  });

  it('is DST-correct across the fall-back night', () => {
    // US DST ends 2026-11-01 02:00 local. 23:00 EDT on 10-31 = 03:00Z; 07:00 EST on 11-01 = 12:00Z.
    expect(quietHoursEnd(new Date('2026-11-01T03:00:00Z'), 'America/New_York', night)?.toISOString()).toBe('2026-11-01T12:00:00.000Z');
  });
});
