import { describe, expect, it } from 'vitest';
import { generateSlots, overlaps } from '@/server/conferences/conference-slots';

/** FR-46: slot generation at range boundaries, slotMinutes 5 and 60, overlap. */
const at = (hhmm: string) => new Date(`2026-12-01T${hhmm}:00Z`);
const iso = (d: Date) => d.toISOString().slice(11, 16);

describe('generateSlots', () => {
  it('fills a range exactly at 10 minutes', () => {
    const slots = generateSlots([{ start: at('15:00'), end: at('17:00') }], 10);
    expect(slots).toHaveLength(12);
    expect(iso(slots[0].startsAt)).toBe('15:00');
    expect(iso(slots[11].endsAt)).toBe('17:00');
  });

  it('drops a trailing partial slot', () => {
    const slots = generateSlots([{ start: at('15:00'), end: at('15:25') }], 10);
    expect(slots.map((s) => iso(s.startsAt))).toEqual(['15:00', '15:10']);
  });

  it('handles the 5 and 60 minute bounds', () => {
    expect(generateSlots([{ start: at('09:00'), end: at('10:00') }], 5)).toHaveLength(12);
    expect(generateSlots([{ start: at('09:00'), end: at('10:00') }], 60)).toHaveLength(1);
    expect(generateSlots([{ start: at('09:00'), end: at('09:59') }], 60)).toHaveLength(0);
  });

  it('merges multiple ranges in time order', () => {
    const slots = generateSlots(
      [
        { start: at('16:00'), end: at('16:20') },
        { start: at('09:00'), end: at('09:10') },
      ],
      10,
    );
    expect(slots.map((s) => iso(s.startsAt))).toEqual(['09:00', '16:00', '16:10']);
  });
});

describe('overlaps', () => {
  const a = { startsAt: at('15:00'), endsAt: at('15:10') };
  it('detects overlap and treats touching as not overlapping', () => {
    expect(overlaps(a, { startsAt: at('15:05'), endsAt: at('15:15') })).toBe(true);
    expect(overlaps(a, { startsAt: at('14:55'), endsAt: at('15:20') })).toBe(true);
    expect(overlaps(a, { startsAt: at('15:10'), endsAt: at('15:20') })).toBe(false);
    expect(overlaps(a, { startsAt: at('14:50'), endsAt: at('15:00') })).toBe(false);
  });
});
