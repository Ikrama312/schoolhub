// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DATABASE_URL ??= 'postgresql://unused@localhost/unused';
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.AUTH_SECRET ??= 'test-secret';
});

import { prisma } from '@/server/db';
import { backfillGradebook } from '@/server/gradebook/backfill';

/** PRD-11 FR-8: pre-existing data (written straight to the DB, no hooks) backfills once. */
const MARK = 'qa-sh11-bf';
const DAY = 86_400_000;
const ids = {} as Record<'year' | 'subject' | 'course' | 'teacher' | 's1' | 's2' | 'assignment' | 'quiz', string>;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

describe.skipIf(!process.env.TEST_DATABASE_URL)('gradebook backfill (integration)', () => {
  beforeAll(async () => {
    const mk = (n: string, role: 'TEACHER' | 'STUDENT') =>
      prisma.user.create({ data: { email: `${n}@${MARK}.test`, firstName: 'QA', lastName: n, role, status: 'ACTIVE' } }).then((u) => u.id);
    Object.assign(ids, { teacher: await mk('teacher', 'TEACHER'), s1: await mk('s1', 'STUDENT'), s2: await mk('s2', 'STUDENT') });
    const now = Date.now();
    ids.year = (await prisma.academicYear.create({ data: { name: MARK, startDate: new Date(isoDay(now - 200 * DAY)), endDate: new Date(isoDay(now + 200 * DAY)) } })).id;
    await prisma.term.create({ data: { academicYearId: ids.year, name: 'T1', order: 1, startDate: new Date(isoDay(now - 100 * DAY)), endDate: new Date(isoDay(now + 100 * DAY)) } });
    ids.subject = (await prisma.subject.create({ data: { name: MARK, code: MARK.toUpperCase() } })).id;
    ids.course = (await prisma.course.create({ data: { name: MARK, code: MARK, academicYearId: ids.year, subjectId: ids.subject, teacherId: ids.teacher } })).id;
    ids.assignment = (
      await prisma.assignment.create({
        data: { courseId: ids.course, title: MARK, submissionType: 'ONLINE_TEXT', maxPoints: '10', dueAt: new Date(now - DAY), status: 'PUBLISHED', createdById: ids.teacher },
      })
    ).id;
    await prisma.submission.create({
      data: { assignmentId: ids.assignment, studentId: ids.s1, status: 'RETURNED', attemptNumber: 1, submittedAt: new Date(now - 2 * DAY), finalScore: '8', returnedAt: new Date() },
    });
    await prisma.submission.create({ data: { assignmentId: ids.assignment, studentId: ids.s2, status: 'SUBMITTED', attemptNumber: 1, submittedAt: new Date(now - 2 * DAY), finalScore: '3' } });
    ids.quiz = (
      await prisma.quiz.create({
        data: { courseId: ids.course, title: MARK, availableFrom: new Date(now - 3 * DAY), availableUntil: new Date(now - DAY), resultsVisibility: 'AFTER_CLOSE', status: 'CLOSED', createdById: ids.teacher, questions: { create: [{ type: 'TRUE_FALSE', prompt: 'x', points: '2', order: 0, correct: { value: true } }] } },
      })
    ).id;
    await prisma.quizAttempt.create({ data: { quizId: ids.quiz, studentId: ids.s2, attemptNumber: 1, status: 'GRADED', submittedAt: new Date(now - 2 * DAY), score: '1', maxScore: '2' } });
  });

  afterAll(async () => {
    const users = [ids.teacher, ids.s1, ids.s2].filter(Boolean);
    await prisma.course.deleteMany({ where: { code: MARK } });
    await prisma.term.deleteMany({ where: { academicYearId: ids.year } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.subject.deleteMany({ where: { code: MARK.toUpperCase() } });
    await prisma.academicYear.deleteMany({ where: { name: MARK } });
  });

  const counts = async () => ({
    items: await prisma.gradeItem.count({ where: { courseId: ids.course } }),
    grades: await prisma.grade.count({ where: { gradeItem: { courseId: ids.course } } }),
  });

  it('creates items and released/returned grades once; a second run changes nothing', async () => {
    await backfillGradebook();
    const first = await counts();
    expect(first).toEqual({ items: 2, grades: 2 });
    const a = await prisma.gradeItem.findUniqueOrThrow({ where: { sourceId: ids.assignment }, include: { grades: true } });
    expect(a.grades.map((g) => [g.studentId, g.score?.toFixed(2)])).toEqual([[ids.s1, '8.00']]); // unreturned s2 never syncs
    const q = await prisma.gradeItem.findUniqueOrThrow({ where: { sourceId: ids.quiz }, include: { grades: true } });
    expect(q.grades[0].score?.toFixed(2)).toBe('1.00');

    const second = await backfillGradebook();
    expect(await counts()).toEqual(first);
    expect(second).toMatchObject({ grades: 0 });
  });
});
