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
import { setExemption, submit } from '@/server/assignments/assignments-service';
import { sendDueReminders } from '@/server/assignments/reminders';

/**
 * PRD-09 reminders against a real, migrated Postgres (NFR-14). Fixtures tagged with MARK and
 * removed afterwards. Skipped without TEST_DATABASE_URL.
 */
const MARK = 'qa-sh9-rem';
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

describe.skipIf(!process.env.TEST_DATABASE_URL)('assignments: reminders (integration)', () => {
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
    await prisma.emailOutbox.deleteMany({ where: { toEmail: { endsWith: `@${MARK}.test` } } });
    await prisma.course.deleteMany({ where: { code: MARK } });
    await prisma.fileObject.deleteMany({ where: { ownerId: { in: users } } });
    await prisma.notification.deleteMany({ where: { userId: { in: users } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.subject.deleteMany({ where: { code: MARK.toUpperCase() } });
    await prisma.academicYear.deleteMany({ where: { name: MARK } });
  });

  const count = (type: string, assignmentTitle: string, userId: string) =>
    prisma.notification.count({ where: { type, userId, title: { contains: assignmentTitle } } });
  const title = async (id: string) => (await prisma.assignment.findUniqueOrThrow({ where: { id } })).title;

  it('due_soon: once per student without a submission, idempotent across calls (FR-43, FR-6)', async () => {
    const a = await mkAssignment({ submissionType: 'ONLINE_TEXT', dueAt: new Date(Date.now() + 2 * 3_600_000) });
    await submit(as(ids.s2, 'STUDENT'), a, { text: 'done', fileIds: [] });
    await sendDueReminders(new Date());
    await sendDueReminders(new Date());
    const t = await title(a);
    expect(await count('assignment.due_soon', t, ids.s1)).toBe(1);
    expect(await count('assignment.due_soon', t, ids.s2)).toBe(0);
  });

  it('missing: parents only, once, never for exempt students or NO_SUBMISSION (FR-45, FR-35, FR-60)', async () => {
    const a = await mkAssignment({ dueAt: new Date(Date.now() - 30 * 3_600_000) });
    const b = await mkAssignment({ dueAt: new Date(Date.now() - 30 * 3_600_000), submissionType: 'NO_SUBMISSION' });
    await prisma.parentStudentLink.create({ data: { parentId: ids.parent, studentId: ids.s2, relationship: 'FATHER' } });
    await setExemption(as(ids.teacher, 'TEACHER'), a, ids.s2, true);
    await Promise.all([sendDueReminders(new Date()), sendDueReminders(new Date())]);
    await sendDueReminders(new Date());
    const [ta, tb] = [await title(a), await title(b)];
    const parentNotes = await prisma.notification.findMany({ where: { type: 'assignment.missing', userId: ids.parent, title: { contains: ta } } });
    expect(parentNotes).toHaveLength(1);
    expect(parentNotes[0].body).toContain('s1');
    expect(await count('assignment.missing', ta, ids.s1)).toBe(0);
    expect(await count('assignment.missing', tb, ids.parent)).toBe(0);
    expect(await prisma.assignmentReminder.count({ where: { assignmentId: a, kind: 'missing' } })).toBe(1);
    expect(await prisma.emailOutbox.count({ where: { toEmail: `parent@${MARK}.test`, subject: { contains: ta } } })).toBe(1);
  });
});
