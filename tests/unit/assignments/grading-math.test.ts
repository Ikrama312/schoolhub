import { describe, expect, it } from 'vitest';
import { fromZonedTime } from 'date-fns-tz';
import {
  computeFinalScore,
  defaultPenalty,
  fixed2,
  lateDays,
  maxRawScore,
  rubricTotal,
  submissionChipStatus,
} from '@/server/assignments/grading-math';

const H = 3_600_000;

describe('lateDays (FR-23, NFR-9)', () => {
  const due = new Date('2026-09-14T22:59:00Z');
  it('is 0 on time and exactly at the deadline', () => {
    expect(lateDays(new Date(due.getTime() - 1), due)).toBe(0);
    expect(lateDays(due, due)).toBe(0);
  });
  it('1 ms late is 1 day; exactly 24 h is 1; 24 h + 1 ms is 2', () => {
    expect(lateDays(new Date(due.getTime() + 1), due)).toBe(1);
    expect(lateDays(new Date(due.getTime() + 24 * H), due)).toBe(1);
    expect(lateDays(new Date(due.getTime() + 24 * H + 1), due)).toBe(2);
  });
  it('PRD example: due Mon 23:59, submitted Wed 10:00 → 2', () => {
    const mon = fromZonedTime('2026-09-14 23:59', 'Europe/London');
    const wed = fromZonedTime('2026-09-16 10:00', 'Europe/London');
    expect(lateDays(wed, mon)).toBe(2);
  });
  it('counts elapsed 24 h across spring-forward (Europe/London, 29 Mar 2026)', () => {
    const d = fromZonedTime('2026-03-28 23:59', 'Europe/London');
    // Same wall clock next day is only 23 h later → still 1 day.
    expect(lateDays(fromZonedTime('2026-03-29 23:59', 'Europe/London'), d)).toBe(1);
    expect(lateDays(new Date(d.getTime() + 24 * H), d)).toBe(1);
    expect(lateDays(new Date(d.getTime() + 24 * H + 1), d)).toBe(2);
  });
  it('counts elapsed 24 h across fall-back (Europe/London, 25 Oct 2026)', () => {
    const d = fromZonedTime('2026-10-24 23:59', 'Europe/London');
    // Same wall clock next day is 25 h later → 2 days.
    expect(lateDays(fromZonedTime('2026-10-25 23:59', 'Europe/London'), d)).toBe(2);
    expect(lateDays(new Date(d.getTime() + 24 * H), d)).toBe(1);
  });
});

describe('defaultPenalty (FR-30)', () => {
  it('multiplies and caps', () => {
    expect(fixed2(defaultPenalty(2, 10, 50))).toBe('20.00');
    expect(fixed2(defaultPenalty(9, '10', '50'))).toBe('50.00');
    expect(fixed2(defaultPenalty(0, 10, 50))).toBe('0.00');
  });
});

describe('computeFinalScore (FR-31, NFR-1)', () => {
  it('18 @ 20 % = "14.40"', () => {
    expect(computeFinalScore(18, 20).toFixed(2)).toBe('14.40');
  });
  it('rounds half-up at .005', () => {
    // 0.01 × 50 % = 0.005 → 0.01; 2.01 × 50 % = 1.005 → 1.01 (float would give 1.00).
    expect(computeFinalScore('0.01', 50).toFixed(2)).toBe('0.01');
    expect(computeFinalScore('2.01', 50).toFixed(2)).toBe('1.01');
  });
  it('no float drift: 0.1 + 0.2 style inputs', () => {
    expect(computeFinalScore('33.33', '33.33').toFixed(2)).toBe('22.22');
    expect(computeFinalScore(100, 0).toFixed(2)).toBe('100.00');
    expect(computeFinalScore(100, 100).toFixed(2)).toBe('0.00');
  });
});

describe('rubricTotal / maxRawScore', () => {
  it('sums criterion maxima exactly', () => {
    expect(rubricTotal([{ maxPoints: '0.1' }, { maxPoints: '0.2' }]).toFixed(2)).toBe('0.30');
    expect(rubricTotal([]).toFixed(2)).toBe('0.00');
    expect(rubricTotal([{ maxPoints: 10 }, { maxPoints: 10 }]).eq(20)).toBe(true);
  });
  it('allows 120 % with extra credit', () => {
    expect(maxRawScore(20, false).toFixed(2)).toBe('20.00');
    expect(maxRawScore(20, true).toFixed(2)).toBe('24.00');
  });
});

describe('submissionChipStatus (FR-28)', () => {
  const sub = (o: Partial<{ status: 'SUBMITTED' | 'RETURNED'; gradedAt: Date | null; isLate: boolean }>) => ({
    status: 'SUBMITTED' as const,
    gradedAt: null,
    isLate: false,
    ...o,
  });
  it('maps every state', () => {
    expect(submissionChipStatus({ exempt: true, submission: sub({}) })).toBe('EXEMPT');
    expect(submissionChipStatus({ exempt: false, submission: null })).toBe('NOT_SUBMITTED');
    expect(submissionChipStatus({ exempt: false, submission: sub({}) })).toBe('SUBMITTED');
    expect(submissionChipStatus({ exempt: false, submission: sub({ isLate: true }) })).toBe('LATE');
    expect(submissionChipStatus({ exempt: false, submission: sub({ isLate: true, gradedAt: new Date() }) })).toBe('GRADED');
    expect(submissionChipStatus({ exempt: false, submission: sub({ status: 'RETURNED', gradedAt: new Date() }) })).toBe('RETURNED');
  });
});
