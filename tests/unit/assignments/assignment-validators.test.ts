import { describe, expect, it } from 'vitest';
import { assignmentInput, gradeInput, submissionInput } from '@/lib/validators/assignments';

const base = {
  title: 'Fractions worksheet',
  submissionType: 'FILE_UPLOAD',
  maxPoints: 20,
  dueAt: '2026-09-14T22:59:00Z',
  status: 'PUBLISHED',
};
const criterion = (maxPoints: number | string) => ({ title: 'C', maxPoints, levels: [{ label: 'Full', points: maxPoints }] });
const messages = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues.map((i) => i.message) ?? [];

describe('assignmentInput (FR-7, FR-11)', () => {
  it('accepts the minimum and applies defaults; decimals become 2 dp strings', () => {
    const r = assignmentInput.parse(base);
    expect(r.maxPoints).toBe('20.00');
    expect(r.maxFileCount).toBe(3);
    expect(r.allowLate).toBe(false);
    expect(r.attachmentFileIds).toEqual([]);
  });

  it('enforces field limits', () => {
    expect(assignmentInput.safeParse({ ...base, title: 'x'.repeat(151) }).success).toBe(false);
    expect(assignmentInput.safeParse({ ...base, maxPoints: 1001 }).success).toBe(false);
    expect(assignmentInput.safeParse({ ...base, maxPoints: '1.234' }).success).toBe(false);
    expect(assignmentInput.safeParse({ ...base, maxFileCount: 11 }).success).toBe(false);
    expect(assignmentInput.safeParse({ ...base, latePenaltyPercentPerDay: 101 }).success).toBe(false);
    expect(assignmentInput.safeParse({ ...base, instructions: 'x'.repeat(50_001) }).success).toBe(false);
  });

  it('requires lateCutoffAt after dueAt', () => {
    const r = assignmentInput.safeParse({ ...base, allowLate: true, lateCutoffAt: base.dueAt });
    expect(messages(r)).toContain('The late cutoff must be after the due date');
  });

  it('rejects a rubric whose criteria do not sum to maxPoints, with the FR-11 copy', () => {
    const r = assignmentInput.safeParse({ ...base, rubric: [criterion(8), criterion(10)] });
    expect(messages(r)).toContain('Rubric totals 18 points but the assignment is worth 20.');
    expect(assignmentInput.safeParse({ ...base, rubric: [criterion('10.5'), criterion('9.5')] }).success).toBe(true);
  });

  it('rejects a level worth more than its criterion', () => {
    const r = assignmentInput.safeParse({
      ...base,
      rubric: [{ title: 'C', maxPoints: 20, levels: [{ label: 'Too much', points: 21 }] }],
    });
    expect(messages(r)).toContain('Level points exceed the criterion maximum');
  });

  it('SCHEDULED needs availableFrom', () => {
    expect(assignmentInput.safeParse({ ...base, status: 'SCHEDULED' }).success).toBe(false);
  });
});

describe('submissionInput / gradeInput', () => {
  it('limits submission text and files', () => {
    expect(submissionInput.safeParse({ text: 'x'.repeat(50_001) }).success).toBe(false);
    expect(submissionInput.safeParse({ fileIds: Array.from({ length: 11 }, (_, i) => `f${i}`) }).success).toBe(false);
    expect(submissionInput.parse({}).fileIds).toEqual([]);
  });

  it('penalty 0–100, feedback ≤ 10k, return defaults false', () => {
    expect(gradeInput.safeParse({ penaltyPercent: 101 }).success).toBe(false);
    expect(gradeInput.safeParse({ penaltyPercent: 0, feedback: 'x'.repeat(10_001) }).success).toBe(false);
    const g = gradeInput.parse({ penaltyPercent: '20', rawScore: 18 });
    expect(g).toMatchObject({ penaltyPercent: '20.00', rawScore: '18.00', return: false });
  });
});
