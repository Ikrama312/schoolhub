// Pure and isomorphic (ADR-3, NFR-8): no Prisma client, no clock. Callers pass `now`.
import { Decimal, dec, fixed2, type DecimalValue } from '@/server/assignments/grading-math';

export type QType = 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'TRUE_FALSE' | 'SHORT_ANSWER' | 'ESSAY';
export type Visibility = 'IMMEDIATELY' | 'AFTER_CLOSE' | 'MANUAL';
export type AttemptState = 'IN_PROGRESS' | 'SUBMITTED' | 'NEEDS_GRADING' | 'GRADED';
export type Policy = 'HIGHEST' | 'LATEST' | 'AVERAGE';

/** FR-16: answer writes are accepted until deadlineAt + 30 s. */
export const ANSWER_GRACE_MS = 30_000;

export interface GradableQuestion {
  type: QType;
  points: DecimalValue;
  correct: unknown;
  caseSensitive?: boolean;
  options?: unknown;
}

export interface Grade {
  pointsAwarded: Decimal | null;
  isCorrect: boolean | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const zero = (): Grade => ({ pointsAwarded: new Decimal(0), isCorrect: false });
const full = (points: DecimalValue): Grade => ({ pointsAwarded: dec(points), isCorrect: true });

/** FR-4: trim and collapse internal whitespace. Case folding is the caller's choice. */
export function normalizeShortAnswer(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

/**
 * FR-2/FR-3/FR-5. Unanswered → 0/false (ESSAY too: still needs review, A8). Answered ESSAY → null/null.
 * A response whose shape doesn't match the type grades as 0/false.
 */
export function gradeAnswer(q: GradableQuestion, response: unknown): Grade {
  if (response == null) return zero();
  if (q.type === 'ESSAY') return { pointsAwarded: null, isCorrect: null };
  if (!isObj(response) || !isObj(q.correct)) return zero();
  const correct = q.correct;

  switch (q.type) {
    case 'SINGLE_CHOICE':
      return typeof response.optionId === 'string' && response.optionId === correct.optionId ? full(q.points) : zero();
    case 'TRUE_FALSE':
      return typeof response.value === 'boolean' && response.value === correct.value ? full(q.points) : zero();
    case 'MULTIPLE_CHOICE': {
      if (!Array.isArray(response.optionIds)) return zero();
      const right = new Set(strings(correct.optionIds));
      if (right.size === 0) return zero();
      const chosen = new Set(strings(response.optionIds));
      let hit = 0;
      let miss = 0;
      for (const id of chosen) (right.has(id) ? hit++ : miss++);
      const ratio = Decimal.max(0, new Decimal(hit - miss).div(right.size));
      const pointsAwarded = dec(q.points).mul(ratio).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      return { pointsAwarded, isCorrect: pointsAwarded.eq(dec(q.points)) };
    }
    case 'SHORT_ANSWER': {
      if (typeof response.text !== 'string') return zero();
      const fold = (s: string) => (q.caseSensitive ? normalizeShortAnswer(s) : normalizeShortAnswer(s).toLowerCase());
      const given = fold(response.text);
      return given !== '' && strings(correct.accepted).some((a) => fold(a) === given) ? full(q.points) : zero();
    }
    default:
      return zero();
  }
}

/** A8: derived "needs review" — ungraded ESSAY, or an unmatched SHORT_ANSWER not yet hand-graded. */
export function needsReview(q: { type: QType }, a: { isCorrect: boolean | null; gradedById: string | null }): boolean {
  if (a.gradedById != null) return false;
  if (q.type === 'ESSAY') return true;
  return q.type === 'SHORT_ANSWER' && a.isCorrect === false;
}

/** FR-13/FR-28, AC-1: min(start + limit + extra, availableUntil); untimed → availableUntil. */
export function computeDeadline(startedAt: Date, timeLimitMinutes: number | null, extraTimeMinutes: number, availableUntil: Date): Date {
  if (timeLimitMinutes == null) return new Date(availableUntil);
  const end = startedAt.getTime() + (timeLimitMinutes + extraTimeMinutes) * 60_000;
  return new Date(Math.min(end, availableUntil.getTime()));
}

/** FR-23/FR-28. */
export function attemptLimit(maxAttempts: number, extraAttempts = 0): number {
  return maxAttempts + extraAttempts;
}

/** FR-20: the one visibility predicate (scores, correct answers, parent access). */
export function resultsVisible(
  quiz: { resultsVisibility: Visibility; availableUntil: Date; resultsReleasedAt: Date | null },
  attempt: { status: AttemptState },
  now: Date,
): boolean {
  if (attempt.status === 'IN_PROGRESS') return false;
  switch (quiz.resultsVisibility) {
    case 'IMMEDIATELY':
      return true;
    case 'AFTER_CLOSE':
      return now.getTime() >= quiz.availableUntil.getTime();
    case 'MANUAL':
      return quiz.resultsReleasedAt != null;
    default:
      return false;
  }
}

/** FR-9: problems blocking publish; empty = publishable. */
export function canPublish(questions: readonly GradableQuestion[]): string[] {
  const problems: string[] = [];
  if (questions.length === 0) problems.push('Add at least one question.');
  questions.forEach((q, i) => {
    const n = `Question ${i + 1}`;
    if (!dec(q.points).gt(0)) problems.push(`${n} needs points greater than 0.`);
    const c = isObj(q.correct) ? q.correct : {};
    const optionIds = Array.isArray(q.options) ? q.options.map((o) => (isObj(o) ? o.id : undefined)) : [];
    if (q.type === 'SINGLE_CHOICE' && !optionIds.includes(c.optionId)) problems.push(`${n} needs a correct answer.`);
    if (q.type === 'MULTIPLE_CHOICE') {
      const ids = strings(c.optionIds);
      if (ids.length === 0 || ids.some((id) => !optionIds.includes(id))) problems.push(`${n} needs a correct answer.`);
    }
    if (q.type === 'TRUE_FALSE' && typeof c.value !== 'boolean') problems.push(`${n} needs a correct answer.`);
    if (q.type === 'SHORT_ANSWER' && strings(c.accepted).length === 0) problems.push(`${n} needs at least one accepted answer.`);
  });
  return problems;
}

/** Score / max as a percentage rounded to 1 dp; null when max is 0. */
export function percentOf(score: DecimalValue, maxScore: DecimalValue): number | null {
  const max = dec(maxScore);
  if (max.lte(0)) return null;
  return dec(score).div(max).mul(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toNumber();
}

export interface ScoredAttempt {
  score: DecimalValue;
  maxScore: DecimalValue;
  submittedAt: Date;
}

/** FR-22: policy over GRADED attempts; null when there are none. Strings are fixed2. */
export function applyScoringPolicy(policy: Policy, attempts: readonly ScoredAttempt[]) {
  if (attempts.length === 0) return null;
  let score: Decimal;
  let maxScore: Decimal;
  if (policy === 'AVERAGE') {
    score = attempts.reduce((s, a) => s.plus(dec(a.score)), new Decimal(0)).div(attempts.length);
    maxScore = attempts.reduce((s, a) => s.plus(dec(a.maxScore)), new Decimal(0)).div(attempts.length);
  } else {
    const pick =
      policy === 'LATEST'
        ? attempts.reduce((a, b) => (b.submittedAt.getTime() > a.submittedAt.getTime() ? b : a))
        : attempts.reduce((a, b) => ((percentOf(b.score, b.maxScore) ?? 0) > (percentOf(a.score, a.maxScore) ?? 0) ? b : a));
    score = dec(pick.score);
    maxScore = dec(pick.maxScore);
  }
  return { score: fixed2(score), maxScore: fixed2(maxScore), percent: percentOf(score, maxScore), attemptsCounted: attempts.length };
}

/** FNV-1a 32-bit string hash → mulberry32 PRNG → Fisher–Yates on a copy. Deterministic per seed (FR-13). */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let state = h >>> 0;
  const rand = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
