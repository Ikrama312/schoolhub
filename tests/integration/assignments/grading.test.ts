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
import { AppError } from '@/server/http';
import { bulkReturn, getSubmission, gradeOffline, gradeSubmission, submit } from '@/server/assignments/assignments-service';

/**
 * PRD-09 grading and return against a real, migrated Postgres (NFR-14). Fixtures tagged with MARK and
 * removed afterwards. Skipped without TEST_DATABASE_URL.
 */
const MARK = 'qa-sh9-grd';
const DAY = 86_400_000;
const ids = {} as Record<'year' | 'subject' | 'course' | 'teacher' | 's1' | 's2' | 'parent', string>;
const as = (id: string, role: 'TEACHER' | 'STUDENT' | 'PARENT') => ({ id, role });

async function code(p: Promise<unknown>) {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return e instanceof AppError ? e.code : (e as Error).message;
  }
}

const mkFile = (ownerId: string, context = 'submission') =>
  prisma.fileObject
    .create({ data: { ownerId, originalName: 'work.pdf', mimeType: 'application/pdf', sizeBytes: 10, storageKey: `${MARK}/${Math.random()}`, sha256: 'x', context } })
    .then((f) => f.id);

const mkAssignment = (data: Partial<Prisma.AssignmentUncheckedCreateInput> = {}) =>
  prisma.assignment
    .create({
      data: {
        courseId: ids.course,
        title: `${MARK} ${Math.random()}`,
        submissionType: 'TEXT_AND_FILE',
        maxPoints: '20',
        dueAt: new Date(Date.now() + DAY),
        status: 'PUBLISHED',
        createdById: ids.teacher,
        notifiedAt: new Date(),
        ...data,
      },
    })
    .then((a) => a.id);

describe.skipIf(!process.env.TEST_DATABASE_URL)('assignments: grading and return (integration)', () => {
  beforeAll(async () => {
    const mk = (n: string, role: 'TEACHER' | 'STUDENT' | 'PARENT') =>
      prisma.user.create({ data: { email: `${n}@${MARK}.test`, firstName: 'QA', lastName: n, role, status: 'ACTIVE' } }).then((u) => u.id);
    Object.assign(ids, { teacher: await mk('teacher', 'TEACHER'), s1: await mk('s1', 'STUDENT'), s2: await mk('s2', 'STUDENT'), parent: await mk('parent', 'PARENT') });
    await prisma.parentStudentLink.create({ data: { parentId: ids.parent, studentId: ids.s1, relationship: 'MOTHER' } });
    ids.year = (await prisma.academicYear.create({ data: { name: MARK, startDate: new Date('2026-01-01'), endDate: new Date('2027-12-31') } })).id;
    ids.subject = (await prisma.subject.create({ data: { name: MARK, code: MARK.toUpperCase() } })).id;
    ids.course = (await prisma.course.create({ data: { name: MARK, code: MARK, academicYearId: ids.year, subjectId: ids.subject, teacherId: ids.teacher } })).id;
    await prisma.enrollment.createMany({ data: [ids.s1, ids.s2].map((studentId) => ({ courseId: ids.course, studentId })) });
  });

  afterAll(async () => {
    const users = [ids.teacher, ids.s1, ids.s2, ids.parent].filter(Boolean);
    const rubricIds = (await prisma.assignment.findMany({ where: { course: { code: MARK } }, select: { rubricId: true } })).map((r) => r.rubricId).filter((x): x is string => !!x);
    await prisma.course.deleteMany({ where: { code: MARK } });
    await prisma.rubric.deleteMany({ where: { id: { in: rubricIds } } });
    await prisma.fileObject.deleteMany({ where: { ownerId: { in: users } } });
    await prisma.notification.deleteMany({ where: { userId: { in: users } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.subject.deleteMany({ where: { code: MARK.toUpperCase() } });
    await prisma.academicYear.deleteMany({ where: { name: MARK } });
  });

  async function rubricAssignment() {
    const rubric = await prisma.rubric.create({
      data: {
        criteria: {
          create: [
            { title: 'Accuracy', maxPoints: '10', order: 0, levels: [{ label: 'Full', points: '10' }, { label: 'Most', points: '8' }] },
            { title: 'Working', maxPoints: '10', order: 1, levels: [{ label: 'Full', points: '10' }, { label: 'Most', points: '9' }] },
          ],
        },
      },
      include: { criteria: { orderBy: { order: 'asc' } } },
    });
    return { id: await mkAssignment({ submissionType: 'ONLINE_TEXT', rubricId: rubric.id }), criteria: rubric.criteria };
  }

  it('derives rawScore from rubric points, ignoring a client raw score (D7, FR-30, FR-31)', async () => {
    const { id, criteria } = await rubricAssignment();
    const { submission } = await submit(as(ids.s1, 'STUDENT'), id, { text: 'answer', fileIds: [] });
    const graded = await gradeSubmission(as(ids.teacher, 'TEACHER'), submission.id, {
      rawScore: '1.00',
      penaltyPercent: '20.00',
      rubricScores: [
        { criterionId: criteria[0].id, points: '8.00' },
        { criterionId: criteria[1].id, points: '9.00' },
      ],
      return: false,
    });
    expect(graded).toMatchObject({ rawScore: '17.00', penaltyPercent: '20.00', finalScore: '13.60', status: 'SUBMITTED' });
    expect(
      await code(gradeSubmission(as(ids.teacher, 'TEACHER'), submission.id, { penaltyPercent: '0.00', rubricScores: [{ criterionId: criteria[0].id, points: '8.00' }], return: false })),
    ).toBe('VALIDATION_ERROR');
    expect(
      await code(
        gradeSubmission(as(ids.teacher, 'TEACHER'), submission.id, {
          penaltyPercent: '0.00',
          rubricScores: [
            { criterionId: criteria[0].id, points: '11.00' },
            { criterionId: criteria[1].id, points: '9.00' },
          ],
          return: false,
        }),
      ),
    ).toBe('VALIDATION_ERROR');
  });

  it('caps the raw score at maxPoints, or 120 % with extra credit (FR-36)', async () => {
    const plain = await mkAssignment({ submissionType: 'ONLINE_TEXT' });
    const s1 = (await submit(as(ids.s1, 'STUDENT'), plain, { text: 'a', fileIds: [] })).submission;
    expect(await code(gradeSubmission(as(ids.teacher, 'TEACHER'), s1.id, { rawScore: '20.01', penaltyPercent: '0.00', return: false }))).toBe('VALIDATION_ERROR');
    const extra = await mkAssignment({ submissionType: 'ONLINE_TEXT', allowExtraCredit: true });
    const s2 = (await submit(as(ids.s1, 'STUDENT'), extra, { text: 'a', fileIds: [] })).submission;
    expect((await gradeSubmission(as(ids.teacher, 'TEACHER'), s2.id, { rawScore: '24.00', penaltyPercent: '0.00', return: false })).finalScore).toBe('24.00');
    expect(await code(gradeSubmission(as(ids.teacher, 'TEACHER'), s2.id, { rawScore: '24.01', penaltyPercent: '0.00', return: false }))).toBe('VALIDATION_ERROR');
  });

  it('hides grades from student and parent until RETURNED, then notifies both (FR-27, FR-44)', async () => {
    const a = await mkAssignment({ submissionType: 'ONLINE_TEXT' });
    const { submission } = await submit(as(ids.s1, 'STUDENT'), a, { text: 'a', fileIds: [] });
    await gradeSubmission(as(ids.teacher, 'TEACHER'), submission.id, { rawScore: '18.00', penaltyPercent: '0.00', feedback: 'Nice', return: false });
    const before = await getSubmission(as(ids.s1, 'STUDENT'), submission.id);
    expect(before).toMatchObject({ rawScore: null, finalScore: null, feedback: null, gradedAt: null });
    expect((await getSubmission(as(ids.parent, 'PARENT'), submission.id)).finalScore).toBeNull();
    expect(await code(getSubmission(as(ids.s2, 'STUDENT'), submission.id))).toBe('NOT_FOUND');

    await gradeSubmission(as(ids.teacher, 'TEACHER'), submission.id, { rawScore: '18.00', penaltyPercent: '0.00', feedback: 'Nice', return: true });
    const after = await getSubmission(as(ids.s1, 'STUDENT'), submission.id);
    expect(after).toMatchObject({ status: 'RETURNED', finalScore: '18.00', feedback: 'Nice' });
    const notes = await prisma.notification.findMany({ where: { type: 'assignment.returned', userId: { in: [ids.s1, ids.parent] } } });
    expect(new Set(notes.map((n) => n.userId))).toEqual(new Set([ids.s1, ids.parent]));
    expect(notes[0].body).toContain('18/20');
  });

  it('bulk return: returns graded work, reports skipped ids, one audit row per submission (FR-32, FR-59)', async () => {
    const a = await mkAssignment({ submissionType: 'ONLINE_TEXT' });
    const g = (await submit(as(ids.s1, 'STUDENT'), a, { text: 'a', fileIds: [] })).submission;
    const u = (await submit(as(ids.s2, 'STUDENT'), a, { text: 'b', fileIds: [] })).submission;
    await gradeSubmission(as(ids.teacher, 'TEACHER'), g.id, { rawScore: '10.00', penaltyPercent: '0.00', return: false });
    const res = await bulkReturn(as(ids.teacher, 'TEACHER'), a, [g.id, u.id, 'nope']);
    expect(res.returned).toEqual([g.id]);
    expect(res.skipped).toEqual(
      expect.arrayContaining([
        { submissionId: u.id, reason: 'NOT_GRADED' },
        { submissionId: 'nope', reason: 'NOT_FOUND' },
      ]),
    );
    expect(await prisma.auditLog.count({ where: { action: 'submission.return', entityId: g.id } })).toBe(1);
    expect((await bulkReturn(as(ids.teacher, 'TEACHER'), a, undefined)).returned).toEqual([]);
  });

  it('offline grade creates attempt 0 and refuses a second one (FR-8, FR-34)', async () => {
    const a = await mkAssignment({ submissionType: 'NO_SUBMISSION' });
    const sub = await gradeOffline(as(ids.teacher, 'TEACHER'), a, { studentId: ids.s2, rawScore: '7.50', return: false });
    expect(sub).toMatchObject({ attemptNumber: 0, text: null, files: [], finalScore: '7.50', penaltyPercent: '0.00' });
    expect(sub.submittedAt).toBe(sub.gradedAt);
    expect(await code(gradeOffline(as(ids.teacher, 'TEACHER'), a, { studentId: ids.s2, rawScore: '8.00', return: false }))).toBe('CONFLICT');
    expect(await code(gradeOffline(as(ids.s1, 'STUDENT'), a, { studentId: ids.s1, rawScore: '8.00', return: false }))).toBe('FORBIDDEN');
  });
});
