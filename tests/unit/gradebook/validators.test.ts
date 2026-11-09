import { describe, expect, it } from 'vitest';
import { bandsSchema, categoriesPutSchema, termOverrideSchema, weightSum } from '@/lib/validators/gradebook';

/** QA (SH-11): FR-16 band rules, FR-17/FR-40 weight sum, FR-23 comment limit. */
const ok = (bands: unknown) => bandsSchema.safeParse(bands).success;

describe('gradebook validators', () => {
  it('FR-16: bands strictly descending, lowest 0, unique letters', () => {
    expect(ok([{ letter: 'A', minPercent: 90 }, { letter: 'B', minPercent: 0 }])).toBe(true);
    expect(ok([{ letter: 'B', minPercent: 0 }, { letter: 'A', minPercent: 90 }])).toBe(false); // ascending
    expect(ok([{ letter: 'A', minPercent: 90 }, { letter: 'B', minPercent: 90 }, { letter: 'F', minPercent: 0 }])).toBe(false); // tie
    expect(ok([{ letter: 'A', minPercent: 90 }, { letter: 'B', minPercent: 10 }])).toBe(false); // lowest not 0
    expect(ok([{ letter: 'A', minPercent: 90 }, { letter: 'A', minPercent: 0 }])).toBe(false); // duplicate letter
    expect(ok([])).toBe(false);
  });

  it('FR-17: weightSum is exact decimal and ignores junk', () => {
    expect(weightSum([{ weightPercent: '33.33' }, { weightPercent: '33.33' }, { weightPercent: '33.34' }])).toBe('100.00');
    expect(weightSum([{ weightPercent: 30 }, { weightPercent: 'abc' }])).toBe('30.00');
  });

  it('FR-40: category names unique (case-insensitive)', () => {
    const r = categoriesPutSchema.safeParse({ categories: [{ name: 'HW', weightPercent: 50, order: 0 }, { name: 'hw', weightPercent: 50, order: 1 }] });
    expect(r.success).toBe(false);
  });

  it('FR-23: teacher comment is capped at 1,000 characters', () => {
    const termId = 'ckxxxxxxxxxxxxxxxxxxxxxxx';
    expect(termOverrideSchema.safeParse({ termId, teacherComment: 'x'.repeat(1000) }).success).toBe(true);
    expect(termOverrideSchema.safeParse({ termId, teacherComment: 'x'.repeat(1001) }).success).toBe(false);
  });
});
