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
import { getSubmission, gradeSubmission, listMyAssignments, setExemption, submit } from '@/server/assignments/assignments-service';
import { canAccessFile } from '@/server/files/access';

/**
 * PRD-09 submit flow against a real, migrated Postgres (NFR-14). Fixtures tagged with MARK and
 * removed afterwards. Skipped without TEST_DATABASE_URL.
 */
const MARK = 'qa-sh9-sub';
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

describe.skipIf(!process.env.TEST_DATABASE_URL)('assignments: submissions (integration)', () => {
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
    await prisma.course.deleteMany({ where: { code: MARK } });
    await prisma.fileObject.deleteMany({ where: { ownerId: { in: users } } });
    await prisma.notification.deleteMany({ where: { userId: { in: users } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.subject.deleteMany({ where: { code: MARK.toUpperCase() } });
    await prisma.academicYear.deleteMany({ where: { name: MARK } });
  });

  it('resubmission snapshots history, keeps old files attached and clears the grade (FR-24, B1)', async () => {
    const a = await mkAssignment();
    const f1 = await mkFile(ids.s1);
    const first = await submit(as(ids.s1, 'STUDENT'), a, { text: 'v1', fileIds: [f1] });
    expect(first.created).toBe(true);
    expect(first.submission.attemptNumber).toBe(1);
    expect((await prisma.fileObject.findUniqueOrThrow({ where: { id: f1 } })).contextId).toBe(first.submission.id);

    await gradeSubmission(as(ids.teacher, 'TEACHER'), first.submission.id, { rawScore: '15.00', penaltyPercent: '0.00', return: false });

    const f2 = await mkFile(ids.s1);
    const second = await submit(as(ids.s1, 'STUDENT'), a, { text: 'v2', fileIds: [f2] });
    expect(second.created).toBe(false);
    expect(second.submission.attemptNumber).toBe(2);
    expect(second.submission.files.map((f) => f.id)).toEqual([f2]);

    const row = await prisma.submission.findUniqueOrThrow({ where: { id: second.submission.id }, include: { history: true } });
    expect(row.rawScore).toBeNull();
    expect(row.gradedAt).toBeNull();
    expect(row.history).toHaveLength(1);
    expect(row.history[0]).toMatchObject({ attemptNumber: 1, text: 'v1', fileIds: [f1] });
    // Old attempt's file is still attached to the submission, so the purge never reclaims it.
    expect((await prisma.fileObject.findUniqueOrThrow({ where: { id: f1 } })).contextId).toBe(row.id);

    const managerView = await getSubmission(as(ids.teacher, 'TEACHER'), row.id);
    expect(managerView.history?.[0].files.map((f) => f.id)).toEqual([f1]);
    const studentView = await getSubmission(as(ids.s1, 'STUDENT'), row.id);
    expect(studentView.history).toBeUndefined();
  });

  it('refuses resubmission once RETURNED (CONFLICT)', async () => {
    const a = await mkAssignment({ submissionType: 'ONLINE_TEXT' });
    const { submission } = await submit(as(ids.s1, 'STUDENT'), a, { text: 'done', fileIds: [] });
    await gradeSubmission(as(ids.teacher, 'TEACHER'), submission.id, { rawScore: '18.00', penaltyPercent: '0.00', return: true });
    expect(await code(submit(as(ids.s1, 'STUDENT'), a, { text: 'again', fileIds: [] }))).toBe('CONFLICT');
  });

  it('applies the deadline and late rules with the server clock (FR-22, FR-23)', async () => {
    const closed = await mkAssignment({ submissionType: 'ONLINE_TEXT', dueAt: new Date(Date.now() - DAY) });
    expect(await code(submit(as(ids.s1, 'STUDENT'), closed, { text: 'x', fileIds: [] }))).toBe('VALIDATION_ERROR');
    const late = await mkAssignment({ submissionType: 'ONLINE_TEXT', dueAt: new Date(Date.now() - 25 * 3_600_000), allowLate: true });
    const { submission } = await submit(as(ids.s1, 'STUDENT'), late, { text: 'x', fileIds: [] });
    expect(submission).toMatchObject({ isLate: true, lateDays: 2 });
  });

  it('rejects files that are not mine or have the wrong context (FR-53)', async () => {
    const a = await mkAssignment({ submissionType: 'FILE_UPLOAD' });
    expect(await code(submit(as(ids.s1, 'STUDENT'), a, { fileIds: [await mkFile(ids.s2)] }))).toBe('VALIDATION_ERROR');
    expect(await code(submit(as(ids.s1, 'STUDENT'), a, { fileIds: [await mkFile(ids.s1, 'assignment')] }))).toBe('VALIDATION_ERROR');
    expect(await code(submit(as(ids.s1, 'STUDENT'), a, { fileIds: [] }))).toBe('VALIDATION_ERROR');
  });

  it('exemption blocks submit and removes the student from Missing (FR-35)', async () => {
    const a = await mkAssignment({ dueAt: new Date(Date.now() - 2 * DAY), allowLate: true });
    const missing = async () => (await listMyAssignments(as(ids.s2, 'STUDENT'), { tab: 'MISSING' })).items.map((r) => (r as { assignment: { id: string } }).assignment.id);
    expect(await missing()).toContain(a);
    await setExemption(as(ids.teacher, 'TEACHER'), a, ids.s2, true, 'Medical');
    expect(await missing()).not.toContain(a);
    expect(await code(submit(as(ids.s2, 'STUDENT'), a, { text: 'x', fileIds: [] }))).toBe('VALIDATION_ERROR');
    await setExemption(as(ids.teacher, 'TEACHER'), a, ids.s2, false);
    expect(await missing()).toContain(a);
  });

  it('NO_SUBMISSION is never missing and cannot be submitted (FR-60)', async () => {
    const a = await mkAssignment({ submissionType: 'NO_SUBMISSION', dueAt: new Date(Date.now() - 2 * DAY) });
    const rows = (await listMyAssignments(as(ids.s2, 'STUDENT'), {})).items as { assignment: { id: string }; group: string }[];
    expect(rows.find((r) => r.assignment.id === a)?.group).toBe('CLOSED');
    const b = await mkAssignment({ submissionType: 'NO_SUBMISSION' });
    expect(await code(submit(as(ids.s1, 'STUDENT'), b, { text: 'x', fileIds: [] }))).toBe('VALIDATION_ERROR');
  });

  it('submission files: only the submitter, linked parent and managers can read them (FR-47, AC-10)', async () => {
    const a = await mkAssignment({ submissionType: 'FILE_UPLOAD' });
    const f = await mkFile(ids.s1);
    await submit(as(ids.s1, 'STUDENT'), a, { fileIds: [f] });
    const file = await prisma.fileObject.findUniqueOrThrow({ where: { id: f } });
    expect(await canAccessFile(as(ids.s1, 'STUDENT'), file)).toBe(true);
    expect(await canAccessFile(as(ids.parent, 'PARENT'), file)).toBe(true);
    expect(await canAccessFile(as(ids.teacher, 'TEACHER'), file)).toBe(true);
    expect(await canAccessFile(as(ids.s2, 'STUDENT'), file)).toBe(false);
    expect(await canAccessFile(null, file)).toBe(false);
  });
});
