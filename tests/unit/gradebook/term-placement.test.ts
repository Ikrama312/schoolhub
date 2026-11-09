import { describe, expect, it } from 'vitest';
import { termFor } from '@/server/gradebook/term-placement';

const terms = [
  { id: 's1', startDate: new Date('2026-09-01T00:00:00Z'), endDate: new Date('2027-01-31T00:00:00Z') },
  { id: 's2', startDate: '2027-02-01', endDate: '2027-06-30' },
];
const NOW = new Date('2026-10-15T10:00:00Z');

describe('termFor', () => {
  it('picks the containing term, inclusive of both ends', () => {
    expect(termFor(new Date('2026-09-01T12:00:00Z'), terms, 'UTC', NOW)?.id).toBe('s1');
    expect(termFor(new Date('2027-01-31T23:59:00Z'), terms, 'UTC', NOW)?.id).toBe('s1');
    expect(termFor(new Date('2027-02-01T00:00:00Z'), terms, 'UTC', NOW)?.id).toBe('s2');
  });

  it('uses the school-local date at day boundaries', () => {
    // 2027-01-31 20:00 in New York is 2027-02-01 01:00 UTC.
    const instant = new Date('2027-02-01T01:00:00Z');
    expect(termFor(instant, terms, 'UTC', NOW)?.id).toBe('s2');
    expect(termFor(instant, terms, 'America/New_York', NOW)?.id).toBe('s1');
    // 2027-02-01 08:00 in Tokyo is 2027-01-31 23:00 UTC.
    expect(termFor(new Date('2027-01-31T23:00:00Z'), terms, 'Asia/Tokyo', NOW)?.id).toBe('s2');
  });

  it('falls back to the term containing today when the date is outside every term or null', () => {
    expect(termFor(new Date('2027-08-01T00:00:00Z'), terms, 'UTC', NOW)?.id).toBe('s1');
    expect(termFor(null, terms, 'UTC', new Date('2027-03-01T00:00:00Z'))?.id).toBe('s2');
  });

  it('returns null when neither the date nor today is in a term (A6)', () => {
    expect(termFor(new Date('2027-08-01T00:00:00Z'), terms, 'UTC', new Date('2027-08-02T00:00:00Z'))).toBeNull();
    expect(termFor(null, [], 'UTC', NOW)).toBeNull();
  });
});
