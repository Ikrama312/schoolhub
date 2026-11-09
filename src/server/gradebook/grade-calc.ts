// Pure and isomorphic (NFR-1): no Prisma client, no clock. Callers pass `now`.
// The gradebook, the student views and report-card generation all call computeStudentTerm, so
// every screen shows the same number (FR-15, AC-1).
import { Decimal, dec, fixed2, type DecimalValue } from '@/server/assignments/grading-math';

export interface CalcItem {
  id: string;
  categoryId: string | null;
  maxPoints: DecimalValue;
  dueAt: Date | null;
  isVisible: boolean;
}

export interface CalcGrade {
  score: DecimalValue | null;
  excused: boolean;
  missing: boolean;
}

export interface CalcCategory {
  id: string;
  name: string;
  weightPercent: DecimalValue;
  dropLowest: number;
  order: number;
}

export interface CalcBand {
  letter: string;
  minPercent: number;
  gpa?: number;
  descriptor?: string;
}

export interface CalcOverride {
  percent: DecimalValue | null;
  letter: string | null;
  teacherComment: string | null;
}

export interface CategoryResult {
  id: string | null;
  name: string;
  weightPercent: string;
  percent: string | null;
  earned: string;
  possible: string;
  droppedItemIds: string[];
}

export interface StudentTermResult {
  categories: CategoryResult[];
  percent: string | null;
  letter: string | null;
  descriptor: string | null;
  computedPercent: string | null;
  computedLetter: string | null;
  overridden: boolean;
  override: { percent: string | null; letter: string | null; teacherComment: string | null } | null;
}

export const UNCATEGORISED = 'Uncategorised';

const HUNDRED = new Decimal(100);

/** FR-13: half-up to 1 dp, applied once at the very end. */
export const roundHalfUp1 = (v: DecimalValue) => dec(v).toDecimalPlaces(1, Decimal.ROUND_HALF_UP);
const pct1 = (v: Decimal | null) => (v === null ? null : roundHalfUp1(v).toFixed(1));

/** FR-10: visible, not excused, and either scored or (missing and past due → 0). */
export function counted(item: CalcItem, grade: CalcGrade | undefined, now: Date): boolean {
  if (!item.isVisible || !grade || grade.excused) return false;
  if (grade.score !== null) return true;
  return grade.missing && item.dueAt !== null && now.getTime() > item.dueAt.getTime();
}

/** FR-29 warning: visible, past due, no score, neither missing nor excused. */
export function isUngradedPastDue(item: CalcItem, grade: CalcGrade | undefined, now: Date): boolean {
  if (!item.isVisible || !item.dueAt || now.getTime() <= item.dueAt.getTime()) return false;
  return !grade || (grade.score === null && !grade.missing && !grade.excused);
}

interface Entry {
  item: CalcItem;
  earned: Decimal;
  max: Decimal;
}

const ratio = (e: Entry) => (e.max.gt(0) ? e.earned.div(e.max) : new Decimal(Infinity));

/** FR-11: drop the n lowest percentages (tie: dueAt, then id), never all of them. */
export function applyDropLowest<T extends Entry>(entries: readonly T[], dropLowest: number): { kept: T[]; dropped: T[] } {
  const n = Math.max(0, Math.min(dropLowest, entries.length - 1));
  if (n === 0) return { kept: [...entries], dropped: [] };
  const sorted = [...entries].sort((a, b) => {
    const c = ratio(a).cmp(ratio(b));
    if (c !== 0) return c;
    const da = a.item.dueAt?.getTime() ?? Infinity;
    const db = b.item.dueAt?.getTime() ?? Infinity;
    if (da !== db) return da - db;
    return a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0;
  });
  const dropped = sorted.slice(0, n);
  return { kept: entries.filter((e) => !dropped.includes(e)), dropped };
}

/** Σ earned / Σ max × 100, unrounded; null when nothing is possible. */
export function categoryPercent(entries: readonly Entry[]): { percent: Decimal | null; earned: Decimal; possible: Decimal } {
  const earned = entries.reduce((s, e) => s.plus(e.earned), new Decimal(0));
  const possible = entries.reduce((s, e) => s.plus(e.max), new Decimal(0));
  return { percent: possible.gt(0) ? earned.div(possible).mul(HUNDRED) : null, earned, possible };
}

/** FR-13: first band (sorted desc) with percent ≥ minPercent. */
export function letterFor(percent: DecimalValue | null, bands: readonly CalcBand[]): CalcBand | null {
  if (percent === null) return null;
  const p = dec(percent);
  return bands.find((b) => p.gte(b.minPercent)) ?? null;
}

/** Course scale, else the school default. */
export function effectiveScale<S>(courseScale: S | null | undefined, defaultScale: S | null | undefined): S | null {
  return courseScale ?? defaultScale ?? null;
}

/** FR-14 / A12: percent replaces percent (letter re-derived unless also set); letter-only keeps the computed percent. */
export function applyOverride(
  computed: { percent: Decimal | null; letter: string | null },
  override: CalcOverride | null | undefined,
  bands: readonly CalcBand[],
): { percent: Decimal | null; letter: string | null; overridden: boolean } {
  const hasPercent = override?.percent !== null && override?.percent !== undefined;
  const hasLetter = !!override?.letter;
  if (!hasPercent && !hasLetter) return { ...computed, overridden: false };
  const percent = hasPercent ? roundHalfUp1(override!.percent!) : computed.percent;
  const letter = hasLetter ? override!.letter! : letterFor(percent, bands)?.letter ?? null;
  return { percent, letter, overridden: true };
}

/** FR-26: ≥ 80 green, 60–79.9 amber, < 60 red. */
export function gradeColour(percent: DecimalValue | null): 'success' | 'warning' | 'error' | null {
  if (percent === null) return null;
  const p = dec(percent);
  if (p.gte(80)) return 'success';
  if (p.gte(60)) return 'warning';
  return 'error';
}

/** Score / max as a 1 dp string for one item; null when ungraded or max is 0. */
export function itemPercent(score: DecimalValue | null, maxPoints: DecimalValue): string | null {
  if (score === null || !dec(maxPoints).gt(0)) return null;
  return pct1(dec(score).div(dec(maxPoints)).mul(HUNDRED));
}

export interface StudentTermInput {
  items: readonly CalcItem[];
  grades: ReadonlyMap<string, CalcGrade>;
  categories: readonly CalcCategory[];
  bands: readonly CalcBand[];
  override?: CalcOverride | null;
  now: Date;
}

/** FR-10–FR-14 for one student, course and term (system-design §3.2). */
export function computeStudentTerm(input: StudentTermInput): StudentTermResult {
  const { items, grades, bands, now } = input;
  const categories = [...input.categories].sort((a, b) => a.order - b.order);
  const known = new Set(categories.map((c) => c.id));
  const bucketOf = (item: CalcItem) => (item.categoryId && known.has(item.categoryId) ? item.categoryId : null);

  const entries = new Map<string | null, Entry[]>();
  for (const item of items) {
    const g = grades.get(item.id);
    if (!counted(item, g, now)) continue;
    const key = bucketOf(item);
    entries.set(key, [...(entries.get(key) ?? []), { item, earned: g!.score === null ? new Decimal(0) : dec(g!.score), max: dec(item.maxPoints) }]);
  }

  const results: CategoryResult[] = [];
  const allKept: Entry[] = [];
  let weighted = new Decimal(0);
  let weightTotal = new Decimal(0);

  for (const c of categories) {
    const { kept, dropped } = applyDropLowest(entries.get(c.id) ?? [], c.dropLowest);
    const r = categoryPercent(kept);
    allKept.push(...kept);
    if (r.percent !== null) {
      weighted = weighted.plus(dec(c.weightPercent).mul(r.percent));
      weightTotal = weightTotal.plus(dec(c.weightPercent));
    }
    results.push({
      id: c.id,
      name: c.name,
      weightPercent: fixed2(c.weightPercent),
      percent: pct1(r.percent),
      earned: fixed2(r.earned),
      possible: fixed2(r.possible),
      droppedItemIds: dropped.map((e) => e.item.id),
    });
  }

  // A8: implicit bucket — shown with its subtotal, weight 0 when the course has categories.
  const hasUncategorised = items.some((i) => i.isVisible && bucketOf(i) === null);
  const loose = entries.get(null) ?? [];
  allKept.push(...loose);
  if (hasUncategorised) {
    const r = categoryPercent(loose);
    results.push({
      id: null,
      name: UNCATEGORISED,
      weightPercent: categories.length ? '0.00' : '100.00',
      percent: pct1(r.percent),
      earned: fixed2(r.earned),
      possible: fixed2(r.possible),
      droppedItemIds: [],
    });
  }

  // FR-12: renormalised weighted mean; points total when there are no categories or none counted.
  const raw = categories.length && weightTotal.gt(0) ? weighted.div(weightTotal) : categoryPercent(allKept).percent;
  const computedPercent = raw === null ? null : roundHalfUp1(raw);
  const computedLetter = letterFor(computedPercent, bands)?.letter ?? null;
  const final = applyOverride({ percent: computedPercent, letter: computedLetter }, input.override, bands);
  const o = input.override;

  return {
    categories: results,
    percent: final.percent === null ? null : final.percent.toFixed(1),
    letter: final.letter,
    descriptor: bands.find((b) => b.letter === final.letter)?.descriptor ?? null,
    computedPercent: computedPercent === null ? null : computedPercent.toFixed(1),
    computedLetter,
    overridden: final.overridden,
    override: o ? { percent: o.percent === null ? null : fixed2(o.percent), letter: o.letter, teacherComment: o.teacherComment } : null,
  };
}
