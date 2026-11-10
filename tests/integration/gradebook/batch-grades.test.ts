// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DATABASE_URL ??= 'postgresql://unused@localhost/unused';
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.AUTH_SECRET ??= 'test-secret';
});

import { prisma } from '@/server/db';
import { loadTermPercents } from '@/server/gradebook/batch-grades';
import { getStudentGrades } from '@/server/gradebook/student-grades-service';

/**
 * PRD-16 §3.4 / FR-13: the batch loader equals getStudentGrades per (student, course) —
 * categories, a hidden item, a missing past-due item and a term override. Real Postgres.
 */
const MARK = 'qa-sh16-bg';
const ids = { students: [] as string[] } as { year: string; term: string; subject: string; teacher: string; c1: string; c2: string; students: string[] };
const admin = { id: 'batch-grades-test', role: 'ADMIN' as const };

describe.skipIf(!process.env.TEST_DATABASE_URL)('gradebook: loadTermPercents parity (integration)', () => {
  beforeAll(async () => {
    const mk = (n: string, role: 'TEACHER' | 'STUDENT') =>
      prisma.user.create({ data: { email: `${n}@${MARK}.test`, firstName: 'QA', lastName: n, role, status: 'ACTIVE' } }).then((u) => u.id);
    ids.teacher = await mk('teacher', 'TEACHER');
    ids.students = [await mk('s1', 'STUDENT'), await mk('s2', 'STUDENT'), await mk('s3', 'STUDENT')];
    ids.year = (await prisma.academicYear.create({ data: { name: MARK, startDate: new Date('2030-01-01'), endDate: new Date('2030-12-31') } })).id;
    ids.term = (await prisma.term.create({ data: { academicYearId: ids.year, name: 'T1', order: 1, startDate: new Date('2030-01-01'), endDate: new Date('2030-06-30') } })).id;
    ids.subject = (await prisma.subject.create({ data: { name: MARK, code: MARK.toUpperCase() } })).id;
    const course = (code: string) =>
      prisma.course.create({ data: { name: code, code, academicYearId: ids.year, subjectId: ids.subject, teacherId: ids.teacher } }).then((c) => c.id);
    ids.c1 = await course(`${MARK}-1`);
    ids.c2 = await course(`${MARK}-2`);
    await prisma.enrollment.createMany({ data: ids.students.flatMap((studentId) => [ids.c1, ids.c2].map((courseId) => ({ courseId, studentId }))) });

    const cat = await prisma.gradeCategory.create({ data: { courseId: ids.c1, name: 'Tests', weightPercent: '60', order: 1 } });
    const hw = await prisma.gradeCategory.create({ data: { courseId: ids.c1, name: 'Homework', weightPercent: '40', order: 2, dropLowest: 1 } });
    const item = (courseId: string, title: string, max: string, data: { categoryId?: string; isVisible?: boolean; dueAt?: Date } = {}) =>
      prisma.gradeItem.create({ data: { courseId, termId: ids.term, title, maxPoints: max, source: 'MANUAL', ...data } }).then((i) => i.id);
    const t1 = await item(ids.c1, 'Test 1', '50', { categoryId: cat.id });
    const h1 = await item(ids.c1, 'HW 1', '10', { categoryId: hw.id });
    const h2 = await item(ids.c1, 'HW 2', '10', { categoryId: hw.id, dueAt: new Date('2030-02-01') });
    const hidden = await item(ids.c1, 'Hidden', '10', { categoryId: cat.id, isVisible: false });
    const p1 = await item(ids.c2, 'Points 1', '20');
    const [s1, s2, s3] = ids.students;
    const grade = (gradeItemId: string, studentId: string, score: string | null, extra: { missing?: boolean; excused?: boolean } = {}) => ({
      gradeItemId,
      studentId,
      score,
      updatedById: ids.teacher,
      ...extra,
    });
    await prisma.grade.createMany({
      data: [
        grade(t1, s1, '41'),
        grade(h1, s1, '7'),
        grade(h2, s1, '9'),
        grade(hidden, s1, '0'),
        grade(p1, s1, '11'),
        grade(t1, s2, '22.5'),
        grade(h2, s2, null, { missing: true }),
        grade(p1, s2, '5'),
        grade(t1, s3, '50', { excused: true }),
      ],
    });
    await prisma.termGradeOverride.create({ data: { courseId: ids.c2, termId: ids.term, studentId: s3, percent: '72.5', updatedById: ids.teacher } });
  });

  afterAll(async () => {
    await prisma.termGradeOverride.deleteMany({ where: { termId: ids.term } });
    await prisma.course.deleteMany({ where: { code: { startsWith: MARK } } });
    await prisma.term.deleteMany({ where: { academicYearId: ids.year } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `@${MARK}.test` } } });
    await prisma.subject.deleteMany({ where: { code: MARK.toUpperCase() } });
    await prisma.academicYear.deleteMany({ where: { name: MARK } });
  });

  it('equals getStudentGrades for every (student, course)', async () => {
    const batch = await loadTermPercents(ids.term, ids.students);
    const all = await loadTermPercents(ids.term);
    for (const studentId of ids.students) {
      const single = await getStudentGrades(admin, studentId, ids.term);
      const expected = single.courses
        .map((c) => ({ courseId: c.course.id, percent: c.percent === null ? null : Number(c.percent), letter: c.letter }))
        .sort((a, b) => a.courseId.localeCompare(b.courseId));
      const sorted = (m: Map<string, { courseId: string }[]>) => [...(m.get(studentId) ?? [])].sort((a, b) => a.courseId.localeCompare(b.courseId));
      expect(sorted(batch)).toEqual(expected);
      expect(sorted(all)).toEqual(expected);
    }
    // sanity: the fixtures produce real numbers, including the override
    expect(batch.get(ids.students[2])!.find((c) => c.courseId === ids.c2)!.percent).toBe(72.5);
    expect(batch.get(ids.students[1])!.find((c) => c.courseId === ids.c2)!.percent).toBe(25);
  });

  it('an empty student list short-circuits; unknown term → empty', async () => {
    expect((await loadTermPercents('nope')).size).toBe(0);
    expect((await loadTermPercents(ids.term, [])).size).toBe(0);
  });
});
