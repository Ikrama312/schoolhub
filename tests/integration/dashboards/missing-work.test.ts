// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DATABASE_URL ??= 'postgresql://unused@localhost/unused';
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.AUTH_SECRET ??= 'test-secret';
});

import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { missingWork } from '@/server/dashboards/missing-work';

/** PRD-16 §3.5 shared missing predicate: window edges, exemptions, NO_SUBMISSION, enrolment. Real Postgres. */
const MARK = 'qa-sh16-mw';
const HOUR = 3_600_000;
const NOW = new Date('2026-11-10T12:00:00Z');
const ids = {} as Record<'year' | 'subject' | 'course' | 'teacher' | 's1' | 's2' | 'dropped', string>;

const mkAssignment = (data: Partial<Prisma.AssignmentUncheckedCreateInput>) =>
  prisma.assignment
    .create({
      data: {
        courseId: ids.course,
        title: `${MARK} ${Math.random()}`,
        submissionType: 'ONLINE_TEXT',
        maxPoints: '10',
        dueAt: new Date(NOW.getTime() - HOUR),
        status: 'PUBLISHED',
        createdById: ids.teacher,
        ...data,
      },
    })
    .then((a) => a.id);

describe.skipIf(!process.env.TEST_DATABASE_URL)('dashboards: missingWork (integration)', () => {
  beforeAll(async () => {
    const mk = (n: string, role: 'TEACHER' | 'STUDENT') =>
      prisma.user.create({ data: { email: `${n}@${MARK}.test`, firstName: 'QA', lastName: n, role, status: 'ACTIVE' } }).then((u) => u.id);
    Object.assign(ids, { teacher: await mk('teacher', 'TEACHER'), s1: await mk('s1', 'STUDENT'), s2: await mk('s2', 'STUDENT'), dropped: await mk('dropped', 'STUDENT') });
    ids.year = (await prisma.academicYear.create({ data: { name: MARK, startDate: new Date('2026-01-01'), endDate: new Date('2027-12-31') } })).id;
    ids.subject = (await prisma.subject.create({ data: { name: MARK, code: MARK.toUpperCase() } })).id;
    ids.course = (await prisma.course.create({ data: { name: MARK, code: MARK, academicYearId: ids.year, subjectId: ids.subject, teacherId: ids.teacher } })).id;
    await prisma.enrollment.createMany({
      data: [
        { courseId: ids.course, studentId: ids.s1 },
        { courseId: ids.course, studentId: ids.s2 },
        { courseId: ids.course, studentId: ids.dropped, status: 'DROPPED', droppedAt: NOW },
      ],
    });
  });

  afterAll(async () => {
    const users = Object.values(ids).length ? [ids.teacher, ids.s1, ids.s2, ids.dropped].filter(Boolean) : [];
    await prisma.course.deleteMany({ where: { code: MARK } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.subject.deleteMany({ where: { code: MARK.toUpperCase() } });
    await prisma.academicYear.deleteMany({ where: { name: MARK } });
  });

  const ofStudent = async (studentId: string, from: Date, to: Date, now = NOW) =>
    ((await missingWork({ studentIds: [ids.s1, ids.s2, ids.dropped], from, to, now })).get(studentId) ?? []).map((m) => m.assignmentId);

  it('window is [from, min(to, now)): from inclusive, to and now exclusive', async () => {
    const from = new Date(NOW.getTime() - 48 * HOUR);
    const atFrom = await mkAssignment({ dueAt: from });
    const beforeFrom = await mkAssignment({ dueAt: new Date(from.getTime() - 1) });
    const atNow = await mkAssignment({ dueAt: NOW });
    const future = await mkAssignment({ dueAt: new Date(NOW.getTime() + HOUR) });
    const inside = await mkAssignment({ dueAt: new Date(NOW.getTime() - HOUR) });

    const got = await ofStudent(ids.s1, from, new Date(NOW.getTime() + 24 * HOUR));
    expect(got).toEqual(expect.arrayContaining([atFrom, inside]));
    expect(got).not.toContain(beforeFrom);
    expect(got).not.toContain(atNow);
    expect(got).not.toContain(future);

    // `to` before now cuts the window there.
    expect(await ofStudent(ids.s1, from, new Date(NOW.getTime() - 2 * HOUR))).toEqual([atFrom]);
  });

  it('excludes submitted, exempt, NO_SUBMISSION, drafts and dropped students', async () => {
    const from = new Date(NOW.getTime() - 200 * HOUR);
    const to = new Date(NOW.getTime() - 100 * HOUR);
    const due = new Date(NOW.getTime() - 150 * HOUR);
    const a = await mkAssignment({ dueAt: due });
    const noSub = await mkAssignment({ dueAt: due, submissionType: 'NO_SUBMISSION' });
    const draft = await mkAssignment({ dueAt: due, status: 'DRAFT' });
    await prisma.submission.create({ data: { assignmentId: a, studentId: ids.s1, attemptNumber: 1, submittedAt: due } });
    await prisma.gradeExemption.create({ data: { assignmentId: a, studentId: ids.s2 } });
    const b = await mkAssignment({ dueAt: due });

    expect(await ofStudent(ids.s1, from, to)).toEqual([b]);
    expect(await ofStudent(ids.s2, from, to)).toEqual([b]);
    expect(await ofStudent(ids.dropped, from, to)).toEqual([]);
    for (const id of [noSub, draft]) expect(await ofStudent(ids.s1, from, to)).not.toContain(id);
  });

  it('studentIds limits the result; an empty list short-circuits', async () => {
    const from = new Date(NOW.getTime() - 48 * HOUR);
    const only = await missingWork({ studentIds: [ids.s2], from, to: NOW, now: NOW });
    expect([...only.keys()]).toEqual([ids.s2]);
    expect((await missingWork({ studentIds: [], from, to: NOW, now: NOW })).size).toBe(0);
  });
});
