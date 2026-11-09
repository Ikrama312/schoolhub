import { describe, expect, it } from 'vitest';
import {
  applyOverride,
  computeStudentTerm,
  counted,
  gradeColour,
  isUngradedPastDue,
  letterFor,
  roundHalfUp1,
  type CalcCategory,
  type CalcGrade,
  type CalcItem,
} from '@/server/gradebook/grade-calc';

/** PRD-11 seed scale (Seed Data). */
const BANDS = [
  ['A', 93], ['A-', 90], ['B+', 87], ['B', 83], ['B-', 80], ['C+', 77],
  ['C', 73], ['C-', 70], ['D+', 67], ['D', 63], ['D-', 60], ['F', 0],
].map(([letter, minPercent]) => ({ letter: letter as string, minPercent: minPercent as number, descriptor: `${letter} desc` }));

const NOW = new Date('2026-11-01T12:00:00Z');
const PAST = new Date('2026-10-01T12:00:00Z');
const FUTURE = new Date('2026-12-01T12:00:00Z');

let n = 0;
const item = (categoryId: string | null, maxPoints: number | string, extra: Partial<CalcItem> = {}): CalcItem => ({
  id: `i${++n}`,
  categoryId,
  maxPoints,
  dueAt: PAST,
  isVisible: true,
  ...extra,
});
const cat = (id: string, weightPercent: number, dropLowest = 0, order = 0): CalcCategory => ({ id, name: id, weightPercent, dropLowest, order });
const scored = (score: number | string | null, extra: Partial<CalcGrade> = {}): CalcGrade => ({ score, excused: false, missing: false, ...extra });

function run(pairs: [CalcItem, CalcGrade | undefined][], categories: CalcCategory[] = [], override: Parameters<typeof computeStudentTerm>[0]['override'] = null) {
  const grades = new Map<string, CalcGrade>();
  for (const [i, g] of pairs) if (g) grades.set(i.id, g);
  return computeStudentTerm({ items: pairs.map(([i]) => i), grades, categories, bands: BANDS, override, now: NOW });
}

describe('computeStudentTerm', () => {
  it('FR-15 golden: Homework 40 % (18/20, 9/10) + Exams 60 % (70/100) = 78.0 % C+ (AC-1)', () => {
    const r = run(
      [
        [item('hw', 20), scored(18)],
        [item('hw', 10), scored(9)],
        [item('ex', 100), scored(70)],
      ],
      [cat('hw', 40, 0, 0), cat('ex', 60, 0, 1)],
    );
    expect(r.categories.map((c) => [c.id, c.percent, c.earned, c.possible])).toEqual([
      ['hw', '90.0', '27.00', '30.00'],
      ['ex', '70.0', '70.00', '100.00'],
    ]);
    expect(r).toMatchObject({ percent: '78.0', letter: 'C+', computedPercent: '78.0', computedLetter: 'C+', overridden: false, descriptor: 'C+ desc' });
  });

  it('no categories → points total', () => {
    const r = run([[item(null, 20), scored(10)], [item(null, 80), scored(70)]]);
    expect(r.percent).toBe('80.0');
    expect(r.categories).toEqual([expect.objectContaining({ id: null, name: 'Uncategorised', weightPercent: '100.00', percent: '80.0' })]);
  });

  it('empty categories are skipped and weights re-normalised', () => {
    const r = run([[item('hw', 10), scored(5)]], [cat('hw', 30), cat('ex', 70, 0, 1)]);
    expect(r.percent).toBe('50.0');
    expect(r.categories.find((c) => c.id === 'ex')?.percent).toBeNull();
  });

  it('nothing counted → percent and letter null', () => {
    const r = run([[item('hw', 10), undefined], [item('hw', 10), scored(null)]], [cat('hw', 100)]);
    expect(r).toMatchObject({ percent: null, letter: null, computedPercent: null });
  });

  it('A8: Uncategorised has weight 0 when the course has categories; falls back to points when no category counts', () => {
    const weighted = run([[item('hw', 10), scored(10)], [item(null, 10), scored(0)]], [cat('hw', 100)]);
    expect(weighted.percent).toBe('100.0');
    expect(weighted.categories.at(-1)).toMatchObject({ id: null, weightPercent: '0.00', percent: '0.0' });

    const fallback = run([[item(null, 10), scored(4)]], [cat('hw', 100)]);
    expect(fallback.percent).toBe('40.0');
  });

  it('AC-2: dropLowest 1 removes the 50 % score', () => {
    const low = item('hw', 10);
    const r = run(
      [
        [low, scored(5)],
        [item('hw', 10), scored(9)],
        [item('hw', 10), scored(10)],
      ],
      [cat('hw', 100, 1)],
    );
    expect(r.categories[0]).toMatchObject({ percent: '95.0', droppedItemIds: [low.id] });
  });

  it('never drops every counted item', () => {
    const r = run([[item('hw', 10), scored(3)], [item('hw', 10), scored(7)]], [cat('hw', 100, 5)]);
    expect(r.categories[0].droppedItemIds).toHaveLength(1);
    expect(r.percent).toBe('70.0');
  });

  it('AC-5: missing past due counts as 0; excused and ungraded do not count', () => {
    const r = run([
      [item(null, 10), scored(10)],
      [item(null, 10), scored(null, { missing: true })],
      [item(null, 10), scored(8, { excused: true })],
      [item(null, 10), scored(null)],
    ]);
    expect(r.percent).toBe('50.0');
  });

  it('missing before the due date (or with no due date) does not count; boundary is strict', () => {
    const future = item(null, 10, { dueAt: FUTURE });
    const noDue = item(null, 10, { dueAt: null });
    const exact = item(null, 10, { dueAt: NOW });
    const m = scored(null, { missing: true });
    expect(counted(future, m, NOW)).toBe(false);
    expect(counted(noDue, m, NOW)).toBe(false);
    expect(counted(exact, m, NOW)).toBe(false);
    expect(counted(exact, m, new Date(NOW.getTime() + 1))).toBe(true);
  });

  it('hidden items do not count', () => {
    const r = run([[item(null, 10), scored(10)], [item(null, 10, { isVisible: false }), scored(0)]]);
    expect(r.percent).toBe('100.0');
  });

  it('rounds once at the end: 89.95 → 90.0 → A- (A3); 77.0 → C+; 76.95 → 77.0 → C+', () => {
    expect(run([[item(null, 200), scored('179.90')]])).toMatchObject({ percent: '90.0', letter: 'A-' });
    expect(run([[item(null, 100), scored(77)]])).toMatchObject({ percent: '77.0', letter: 'C+' });
    expect(run([[item(null, 2000), scored('1539.00')]])).toMatchObject({ percent: '77.0', letter: 'C+' });
    expect(run([[item(null, 100), scored('76.94')]])).toMatchObject({ percent: '76.9', letter: 'C' });
  });

  it('weighted mean uses unrounded category percents', () => {
    // hw 1/3 = 33.333…, ex 2/3 = 66.666…; 50/50 → exactly 50.0 (rounding categories first would also give 50.0,
    // so use 1/3 vs 1/6: 33.333 * .5 + 16.667 * .5 = 25.0)
    const r = run([[item('hw', 3), scored(1)], [item('ex', 6), scored(1)]], [cat('hw', 50), cat('ex', 50, 0, 1)]);
    expect(r.percent).toBe('25.0');
  });

  it('AC-6: letter-only override keeps the computed percent', () => {
    const r = run([[item(null, 100), scored(78)]], [], { percent: null, letter: 'B', teacherComment: null });
    expect(r).toMatchObject({ percent: '78.0', letter: 'B', computedLetter: 'C+', overridden: true, descriptor: 'B desc' });
  });

  it('A12: percent-only override re-derives the letter; both set use both; comment-only is not an override', () => {
    expect(run([[item(null, 100), scored(78)]], [], { percent: '91', letter: null, teacherComment: null })).toMatchObject({ percent: '91.0', letter: 'A-', computedPercent: '78.0' });
    expect(run([[item(null, 100), scored(78)]], [], { percent: '91', letter: 'B', teacherComment: null })).toMatchObject({ percent: '91.0', letter: 'B' });
    const c = run([[item(null, 100), scored(78)]], [], { percent: null, letter: null, teacherComment: 'Good' });
    expect(c).toMatchObject({ overridden: false, letter: 'C+', override: { teacherComment: 'Good' } });
  });
});

describe('helpers', () => {
  it('letterFor / roundHalfUp1 / applyOverride', () => {
    expect(letterFor('92.99', BANDS)?.letter).toBe('A-');
    expect(letterFor('0', BANDS)?.letter).toBe('F');
    expect(letterFor(null, BANDS)).toBeNull();
    expect(roundHalfUp1('0.05').toFixed(1)).toBe('0.1');
    expect(applyOverride({ percent: null, letter: null }, null, BANDS).overridden).toBe(false);
  });

  it('gradeColour bands (FR-26)', () => {
    expect(gradeColour('80.0')).toBe('success');
    expect(gradeColour('79.9')).toBe('warning');
    expect(gradeColour('60.0')).toBe('warning');
    expect(gradeColour('59.9')).toBe('error');
    expect(gradeColour(null)).toBeNull();
  });

  it('isUngradedPastDue (FR-29 warning)', () => {
    const i = item(null, 10);
    expect(isUngradedPastDue(i, undefined, NOW)).toBe(true);
    expect(isUngradedPastDue(i, scored(null, { missing: true }), NOW)).toBe(false);
    expect(isUngradedPastDue(i, scored(null, { excused: true }), NOW)).toBe(false);
    expect(isUngradedPastDue(i, scored(5), NOW)).toBe(false);
    expect(isUngradedPastDue(item(null, 10, { dueAt: FUTURE }), undefined, NOW)).toBe(false);
  });
});
