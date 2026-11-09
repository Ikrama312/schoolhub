import { describe, expect, it } from 'vitest';
import {
  applyScoringPolicy,
  attemptLimit,
  canPublish,
  computeDeadline,
  gradeAnswer,
  needsReview,
  normalizeShortAnswer,
  resultsVisible,
  seededShuffle,
} from '@/server/quiz/grading';

const g = (q: Parameters<typeof gradeAnswer>[0], r: unknown) => {
  const x = gradeAnswer(q, r);
  return { points: x.pointsAwarded?.toFixed(2) ?? null, isCorrect: x.isCorrect };
};
const opts = ['A', 'B', 'C', 'D'].map((id) => ({ id, text: id }));

describe('gradeAnswer (FR-2)', () => {
  it('SINGLE_CHOICE full or 0', () => {
    const q = { type: 'SINGLE_CHOICE' as const, points: 2, correct: { optionId: 'A' } };
    expect(g(q, { optionId: 'A' })).toEqual({ points: '2.00', isCorrect: true });
    expect(g(q, { optionId: 'B' })).toEqual({ points: '0.00', isCorrect: false });
  });

  it('MULTIPLE_CHOICE partial credit — FR-2 example (AC-4)', () => {
    const q = { type: 'MULTIPLE_CHOICE' as const, points: 4, correct: { optionIds: ['A', 'C'] } };
    expect(g(q, { optionIds: ['A', 'B'] })).toEqual({ points: '0.00', isCorrect: false });
    expect(g(q, { optionIds: ['A'] })).toEqual({ points: '2.00', isCorrect: false });
    expect(g(q, { optionIds: ['A', 'C'] })).toEqual({ points: '4.00', isCorrect: true });
    expect(g(q, { optionIds: ['B', 'D'] })).toEqual({ points: '0.00', isCorrect: false });
    expect(g(q, { optionIds: ['A', 'C', 'D'] })).toEqual({ points: '2.00', isCorrect: false });
  });

  it('TRUE_FALSE', () => {
    const q = { type: 'TRUE_FALSE' as const, points: 1, correct: { value: true } };
    expect(g(q, { value: true }).isCorrect).toBe(true);
    expect(g(q, { value: false }).isCorrect).toBe(false);
  });

  it('SHORT_ANSWER normalises; " Photosynthesis " is correct (AC-5)', () => {
    const q = { type: 'SHORT_ANSWER' as const, points: 3, correct: { accepted: ['photosynthesis', 'photo-synthesis'] } };
    expect(g(q, { text: ' Photosynthesis ' })).toEqual({ points: '3.00', isCorrect: true });
    expect(g(q, { text: 'photo-synthesis' }).isCorrect).toBe(true);
    expect(g(q, { text: 'respiration' })).toEqual({ points: '0.00', isCorrect: false });
    expect(g({ ...q, caseSensitive: true }, { text: 'Photosynthesis' }).isCorrect).toBe(false);
    expect(normalizeShortAnswer('  a   b \n c ')).toBe('a b c');
  });

  it('ESSAY is manual; unanswered anything is 0/false; wrong shape is 0', () => {
    expect(g({ type: 'ESSAY', points: 5, correct: {} }, { text: 'essay' })).toEqual({ points: null, isCorrect: null });
    expect(g({ type: 'ESSAY', points: 5, correct: {} }, null)).toEqual({ points: '0.00', isCorrect: false });
    expect(g({ type: 'SINGLE_CHOICE', points: 2, correct: { optionId: 'A' } }, null)).toEqual({ points: '0.00', isCorrect: false });
    expect(g({ type: 'SINGLE_CHOICE', points: 2, correct: { optionId: 'A' } }, { text: 'A' }).isCorrect).toBe(false);
  });
});

describe('needsReview (A8)', () => {
  it('ungraded essay or unmatched short answer', () => {
    expect(needsReview({ type: 'ESSAY' }, { isCorrect: null, gradedById: null })).toBe(true);
    expect(needsReview({ type: 'ESSAY' }, { isCorrect: true, gradedById: 't' })).toBe(false);
    expect(needsReview({ type: 'SHORT_ANSWER' }, { isCorrect: false, gradedById: null })).toBe(true);
    expect(needsReview({ type: 'SHORT_ANSWER' }, { isCorrect: true, gradedById: null })).toBe(false);
    expect(needsReview({ type: 'SINGLE_CHOICE' }, { isCorrect: false, gradedById: null })).toBe(false);
  });
});

describe('computeDeadline / attemptLimit (FR-13, FR-23, FR-28)', () => {
  const start = new Date('2026-11-10T10:00:00Z');
  it('AC-1: 20 min limit, closes in 10 → deadline is close', () => {
    const until = new Date('2026-11-10T10:10:00Z');
    expect(computeDeadline(start, 20, 0, until)).toEqual(until);
  });
  it('timed, with extra time, untimed', () => {
    const until = new Date('2026-11-10T12:00:00Z');
    expect(computeDeadline(start, 20, 0, until).toISOString()).toBe('2026-11-10T10:20:00.000Z');
    expect(computeDeadline(start, 20, 10, until).toISOString()).toBe('2026-11-10T10:30:00.000Z');
    expect(computeDeadline(start, null, 10, until)).toEqual(until);
  });
  it('attemptLimit adds extra attempts (AC-8)', () => {
    expect(attemptLimit(2, 0)).toBe(2);
    expect(attemptLimit(2, 1)).toBe(3);
  });
});

describe('applyScoringPolicy (FR-22)', () => {
  const a = [
    { score: 6, maxScore: 10, submittedAt: new Date('2026-11-01') },
    { score: 8, maxScore: 10, submittedAt: new Date('2026-11-02') },
    { score: 7, maxScore: 10, submittedAt: new Date('2026-11-03') },
  ];
  it('HIGHEST (AC-8: 60 % and 80 % → 80 %)', () => {
    expect(applyScoringPolicy('HIGHEST', a.slice(0, 2))).toMatchObject({ score: '8.00', percent: 80 });
  });
  it('LATEST and AVERAGE', () => {
    expect(applyScoringPolicy('LATEST', a)).toMatchObject({ score: '7.00', percent: 70 });
    expect(applyScoringPolicy('AVERAGE', a)).toMatchObject({ score: '7.00', maxScore: '10.00', percent: 70, attemptsCounted: 3 });
  });
  it('null without graded attempts', () => {
    expect(applyScoringPolicy('HIGHEST', [])).toBeNull();
  });
});

describe('resultsVisible (FR-20)', () => {
  const now = new Date('2026-11-10T10:00:00Z');
  const submitted = { status: 'GRADED' as const };
  const base = { availableUntil: new Date('2026-11-10T11:00:00Z'), resultsReleasedAt: null };
  it('never while in progress', () => {
    expect(resultsVisible({ ...base, resultsVisibility: 'IMMEDIATELY' }, { status: 'IN_PROGRESS' }, now)).toBe(false);
  });
  it('IMMEDIATELY / AFTER_CLOSE / MANUAL', () => {
    expect(resultsVisible({ ...base, resultsVisibility: 'IMMEDIATELY' }, submitted, now)).toBe(true);
    expect(resultsVisible({ ...base, resultsVisibility: 'AFTER_CLOSE' }, submitted, now)).toBe(false);
    expect(resultsVisible({ ...base, resultsVisibility: 'AFTER_CLOSE' }, submitted, base.availableUntil)).toBe(true);
    expect(resultsVisible({ ...base, resultsVisibility: 'MANUAL' }, submitted, now)).toBe(false);
    expect(resultsVisible({ ...base, resultsVisibility: 'MANUAL', resultsReleasedAt: now }, submitted, now)).toBe(true);
  });
});

describe('canPublish (FR-9)', () => {
  it('needs ≥ 1 question, correct answers, points > 0', () => {
    expect(canPublish([])).toEqual(['Add at least one question.']);
    expect(canPublish([{ type: 'SINGLE_CHOICE', points: 1, options: opts, correct: { optionId: 'A' } }])).toEqual([]);
    expect(canPublish([{ type: 'SINGLE_CHOICE', points: 1, options: opts, correct: {} }])).toHaveLength(1);
    expect(canPublish([{ type: 'MULTIPLE_CHOICE', points: 1, options: opts, correct: { optionIds: [] } }])).toHaveLength(1);
    expect(canPublish([{ type: 'ESSAY', points: 0, correct: {} }])).toEqual(['Question 1 needs points greater than 0.']);
  });
});

describe('seededShuffle (FR-13)', () => {
  const items = Array.from({ length: 20 }, (_, i) => i);
  it('is deterministic per seed, a permutation, and seed-dependent', () => {
    const a = seededShuffle(items, 'attempt-1');
    expect(seededShuffle(items, 'attempt-1')).toEqual(a);
    expect([...a].sort((x, y) => x - y)).toEqual(items);
    expect(seededShuffle(items, 'attempt-2')).not.toEqual(a);
    expect(items[0]).toBe(0);
  });
});
