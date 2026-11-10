import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sectionFindUnique, assertCanManageCourse } = vi.hoisted(() => ({
  sectionFindUnique: vi.fn(),
  assertCanManageCourse: vi.fn(),
}));
vi.mock('@/server/db', () => ({ prisma: { section: { findUnique: sectionFindUnique } } }));
vi.mock('@/server/auth/course-access', () => ({ assertCanManageCourse }));

import { AppError } from '@/server/http';
import { audienceMatchesClauses, canTargetAudience } from '@/server/announcements/audience';

const admin = { id: 'a', role: 'ADMIN' as const };
const teacher = { id: 't', role: 'TEACHER' as const };

describe('canTargetAudience (FR-7)', () => {
  beforeEach(() => {
    sectionFindUnique.mockReset();
    assertCanManageCourse.mockReset();
  });

  it('ADMIN may target anything', async () => {
    for (const type of ['SCHOOL', 'STAFF', 'ROLE', 'GRADE_LEVEL', 'SECTION', 'COURSE'] as const) {
      expect(await canTargetAudience(admin, { type, refId: null })).toBe(true);
    }
  });

  it('TEACHER may not target SCHOOL, STAFF, ROLE or GRADE_LEVEL', async () => {
    for (const type of ['SCHOOL', 'STAFF'] as const) expect(await canTargetAudience(teacher, { type, refId: null })).toBe(false);
    expect(await canTargetAudience(teacher, { type: 'ROLE', refId: 'PARENT' })).toBe(false);
    expect(await canTargetAudience(teacher, { type: 'GRADE_LEVEL', refId: 'g7' })).toBe(false);
  });

  it('TEACHER may target a COURSE they manage only', async () => {
    assertCanManageCourse.mockResolvedValueOnce(undefined);
    expect(await canTargetAudience(teacher, { type: 'COURSE', refId: 'c1' })).toBe(true);
    assertCanManageCourse.mockRejectedValueOnce(new AppError('FORBIDDEN', 'no'));
    expect(await canTargetAudience(teacher, { type: 'COURSE', refId: 'c2' })).toBe(false);
  });

  it('TEACHER may target their homeroom SECTION only', async () => {
    sectionFindUnique.mockResolvedValueOnce({ homeroomTeacherId: 't' });
    expect(await canTargetAudience(teacher, { type: 'SECTION', refId: 's1' })).toBe(true);
    sectionFindUnique.mockResolvedValueOnce({ homeroomTeacherId: 'other' });
    expect(await canTargetAudience(teacher, { type: 'SECTION', refId: 's2' })).toBe(false);
  });

  it('STUDENT and PARENT may target nothing', async () => {
    expect(await canTargetAudience({ id: 's', role: 'STUDENT' }, { type: 'COURSE', refId: 'c1' })).toBe(false);
    expect(await canTargetAudience({ id: 'p', role: 'PARENT' }, { type: 'SECTION', refId: 's1' })).toBe(false);
  });
});

describe('audienceMatchesClauses', () => {
  const row = (type: 'GRADE_LEVEL' | 'SCHOOL', refId: string | null, flags = { includeStudents: true, includeParents: true, includeTeachers: true }) => ({ type, refId, ...flags });
  it('"Grade 7 parents" matches a parent of a grade-7 child but not the child', () => {
    const g7Parents = row('GRADE_LEVEL', 'g7', { includeStudents: false, includeParents: true, includeTeachers: false });
    expect(audienceMatchesClauses(g7Parents, [{ type: 'GRADE_LEVEL', refIds: ['g7'], flag: 'includeParents' }])).toBe(true);
    expect(audienceMatchesClauses(g7Parents, [{ type: 'GRADE_LEVEL', refIds: ['g7'], flag: 'includeStudents' }])).toBe(false);
    expect(audienceMatchesClauses(row('SCHOOL', null), [{ type: 'SCHOOL' }])).toBe(true);
  });
});
