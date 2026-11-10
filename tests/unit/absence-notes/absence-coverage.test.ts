import { describe, expect, it } from 'vitest';
import { coversRecord } from '@/server/absence-notes/absence-coverage';

/** FR-46: absence coverage — whole day, partial periods, multi-day, null periodId. */
const whole = { fromDate: '2026-11-10', toDate: '2026-11-10', partialDay: false, periodIds: [] };
const partial = { fromDate: '2026-11-10', toDate: '2026-11-10', partialDay: true, periodIds: ['p1', 'p3'] };

describe('coversRecord', () => {
  it('whole day covers every period on the date', () => {
    expect(coversRecord(whole, { date: '2026-11-10', periodId: 'p1' })).toBe(true);
    expect(coversRecord(whole, { date: '2026-11-10', periodId: 'p9' })).toBe(true);
    expect(coversRecord(whole, { date: '2026-11-11', periodId: 'p1' })).toBe(false);
  });

  it('partial day covers only the listed periods', () => {
    expect(coversRecord(partial, { date: '2026-11-10', periodId: 'p1' })).toBe(true);
    expect(coversRecord(partial, { date: '2026-11-10', periodId: 'p3' })).toBe(true);
    expect(coversRecord(partial, { date: '2026-11-10', periodId: 'p2' })).toBe(false);
  });

  it('multi-day covers inclusive bounds only', () => {
    const multi = { ...whole, fromDate: '2026-11-09', toDate: '2026-11-12' };
    expect(coversRecord(multi, { date: '2026-11-08', periodId: 'p1' })).toBe(false);
    expect(coversRecord(multi, { date: '2026-11-09', periodId: 'p1' })).toBe(true);
    expect(coversRecord(multi, { date: '2026-11-12', periodId: 'p1' })).toBe(true);
    expect(coversRecord(multi, { date: '2026-11-13', periodId: 'p1' })).toBe(false);
  });

  it('a null periodId (daily homeroom) is covered by any note on that date', () => {
    expect(coversRecord(whole, { date: '2026-11-10', periodId: null })).toBe(true);
    expect(coversRecord(partial, { date: '2026-11-10', periodId: null })).toBe(true);
    expect(coversRecord(partial, { date: '2026-11-11', periodId: null })).toBe(false);
  });
});
