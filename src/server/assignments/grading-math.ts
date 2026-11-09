// Pure and isomorphic (ADR-7): imported by the grading UI for the live preview and by the
// service for the stored value. No Prisma client import. Decimal comes from Prisma's browser
// runtime, which bundles decimal.js, so no new dependency is needed (ADR-1); decimal.js itself is
// only a transitive devDependency here and would not be installed in production.
import { Decimal } from '@prisma/client/runtime/index-browser.js';

export { Decimal };
export type DecimalValue = string | number | { toString(): string };

const DAY_MS = 24 * 60 * 60 * 1000;

export const dec = (v: DecimalValue) => new Decimal(typeof v === 'number' ? v : v.toString());

/** "14.40" — the wire and storage form (NFR-1, D5). */
export const fixed2 = (v: DecimalValue) => dec(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

/**
 * FR-23: ceil(elapsed / 24 h) on UTC instants, so a DST change in the school timezone does not
 * matter and exactly 24 h late is 1 day (NFR-9). On time (≤ dueAt) is 0.
 */
export function lateDays(submittedAt: Date, dueAt: Date): number {
  const ms = submittedAt.getTime() - dueAt.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / DAY_MS);
}

/** FR-30: min(lateDays × perDay, max), the pre-filled penalty percent. */
export function defaultPenalty(days: number, perDay: DecimalValue, max: DecimalValue): Decimal {
  return Decimal.min(dec(perDay).mul(days), dec(max));
}

/** FR-31: raw × (1 − pct/100), rounded half-up to 2 dp. */
export function computeFinalScore(raw: DecimalValue, penaltyPercent: DecimalValue): Decimal {
  return dec(raw)
    .mul(new Decimal(100).minus(dec(penaltyPercent)))
    .div(100)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** FR-11: Σ criterion maxPoints. */
export function rubricTotal(criteria: readonly { maxPoints: DecimalValue }[]): Decimal {
  return criteria.reduce((sum, c) => sum.plus(dec(c.maxPoints)), new Decimal(0));
}

/** FR-36: maxPoints, or 120 % of it when extra credit is allowed (raw score only). */
export function maxRawScore(maxPoints: DecimalValue, allowExtraCredit: boolean): Decimal {
  return allowExtraCredit ? dec(maxPoints).mul('1.2') : dec(maxPoints);
}

export type ChipStatus = 'NOT_SUBMITTED' | 'SUBMITTED' | 'LATE' | 'GRADED' | 'RETURNED' | 'EXEMPT';

/** FR-28 roster chip. Exempt wins; then the most advanced state of the submission. */
export function submissionChipStatus(row: {
  exempt: boolean;
  submission: { status: 'SUBMITTED' | 'RETURNED'; gradedAt: Date | string | null; isLate: boolean } | null;
}): ChipStatus {
  if (row.exempt) return 'EXEMPT';
  const s = row.submission;
  if (!s) return 'NOT_SUBMITTED';
  if (s.status === 'RETURNED') return 'RETURNED';
  if (s.gradedAt) return 'GRADED';
  return s.isLate ? 'LATE' : 'SUBMITTED';
}
