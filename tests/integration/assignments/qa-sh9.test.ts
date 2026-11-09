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
import {
  createAssignment,
  deleteOrArchiveAssignment,
  duplicateAssignment,
  getAssignment,
  getSubmission,
  gradeSubmission,
  listCourseAssignments,
  listGradingRoster,
  listMyAssignments,
  publishOnce,
  submit,
  updateAssignment,
} from '@/server/assignments/assignments-service';
import { assignmentInput } from '@/lib/validators/assignments';

/**
 * QA (SH-9) gap coverage: visibility/scheduling (FR-12, FR-13, FR-42, FR-52), delete vs archive (FR-51),
 * duplicate (FR-15), privacy + access control (NFR-4, NFR-5, FR-55, FR-57), roster (FR-54),
 * teacher "To grade" (FR-39), max-points edit keeps scores (FR-14). Real Postgres; skipped without TEST_DATABASE_URL.
 */
const MARK = 'qa-sh9-gap';
const DAY = 86_400_000;
const ids = {} as Record<'year' | 'subject' | 'course' | 'course2' | 'other' | 'teacher' | 'teacher2' | 's1' | 's2' | 's3' | 'parent' | 'parent2', string>;
const as = (id: string, role: 'TEACHER' | 'STUDENT' | 'PARENT') => ({ id, role });
const T = () => as(ids.teacher, 'TEACHER');

async function code(p: Promise<unknown>) {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return e instanceof AppError ? e.code : (e as Error).message;
  }
}

const mkAssignment = (data: Partial<Prisma.AssignmentUncheckedCreateInput> = {}) =>
  prisma.assignment
    .create({
      data: {
        courseId: ids.course,
        title: `${MARK} ${Math.random()}`,
        submissionType: 'ONLINE_TEXT',
        maxPoints: '20',
        dueAt: new Date(Date.now() + DAY),
        status: 'PUBLISHED',
        createdById: ids.teacher,
        notifiedAt: new Date(),
        ...data,
      },
    })
    .then((a) => a.id);

const input = (over: Record<string, unknown> = {}) =>
  assignmentInput.parse({ title: `${MARK} created`, submissionType: 'ONLINE_TEXT', maxPoints: 20, dueAt: new Date(Date.now() + 3 * DAY), status: 'PUBLISHED', ...over });

const published = (userId: string, link: string) =>
  prisma.notification.count({ where: { userId, type: 'assignment.published', link: { contains: link } } });

describe.skipIf(!process.env.TEST_DATABASE_URL)('assignments: QA gap coverage (SH-9)', () => {
  beforeAll(async () => {
    const mk = (n: string, role: 'TEACHER' | 'STUDENT' | 'PARENT') =>
      prisma.user.create({ data: { email: `${n}@${MARK}.test`, firstName: 'QA', lastName: n, role, status: 'ACTIVE' } }).then((u) => u.id);
    Object.assign(ids, {
      teacher: await mk('teacher', 'TEACHER'),
      teacher2: await mk('teacher2', 'TEACHER'),
      s1: await mk('s1', 'STUDENT'),
      s2: await mk('s2', 'STUDENT'),
      s3: await mk('s3', 'STUDENT'),
      parent: await mk('parent', 'PARENT'),
      parent2: await mk('parent2', 'PARENT'),
    });
    await prisma.parentStudentLink.create({ data: { parentId: ids.parent, studentId: ids.s1, relationship: 'MOTHER' } });
    ids.year = (await prisma.academicYear.create({ data: { name: MARK, startDate: new Date('2026-01-01'), endDate: new Date('2027-12-31') } })).id;
    ids.subject = (await prisma.subject.create({ data: { name: MARK, code: MARK.toUpperCase() } })).id;
    const course = (code: string, teacherId: string) =>
      prisma.course.create({ data: { name: code, code, academicYearId: ids.year, subjectId: ids.subject, teacherId } }).then((c) => c.id);
    ids.course = await course(MARK, ids.teacher);
    ids.course2 = await course(`${MARK}-2`, ids.teacher);
    ids.other = await course(`${MARK}-x`, ids.teacher2);
    // s3 is NOT enrolled in the main course.
    await prisma.enrollment.createMany({ data: [ids.s1, ids.s2].map((studentId) => ({ courseId: ids.course, studentId })) });
    await prisma.enrollment.create({ data: { courseId: ids.other, studentId: ids.s3 } });
  });

  afterAll(async () => {
    const users = Object.entries(ids).filter(([k]) => /^(teacher|s\d|parent)/.test(k)).map(([, v]) => v);
    const codes = [MARK, `${MARK}-2`, `${MARK}-x`];
    const rubricIds = (await prisma.assignment.findMany({ where: { course: { code: { in: codes } } }, select: { rubricId: true } }))
      .map((r) => r.rubricId)
      .filter((x): x is string => !!x);
    await prisma.course.deleteMany({ where: { code: { in: codes } } });
    await prisma.rubric.deleteMany({ where: { id: { in: rubricIds } } });
    await prisma.fileObject.deleteMany({ where: { ownerId: { in: users } } });
    await prisma.notification.deleteMany({ where: { userId: { in: users } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.subject.deleteMany({ where: { code: MARK.toUpperCase() } });
    await prisma.academicYear.deleteMany({ where: { name: MARK } });
  });

  it('FR-12/FR-42: publish on create notifies each ACTIVE student exactly once; a past schedule is rejected', async () => {
    const a = await createAssignment(T(), ids.course, input());
    await publishOnce(a.id);
    await Promise.all([publishOnce(a.id), publishOnce(a.id)]);
    expect(await published(ids.s1, a.id)).toBe(1);
    expect(await published(ids.s2, a.id)).toBe(1);
    expect(await published(ids.s3, a.id)).toBe(0);
    expect(await code(createAssignment(T(), ids.course, input({ status: 'SCHEDULED', availableFrom: new Date(Date.now() - DAY) })))).toBe('VALIDATION_ERROR');
  });

  it('FR-13/FR-42: SCHEDULED is hidden until availableFrom, then visible on read and notified once', async () => {
    const future = await mkAssignment({ status: 'SCHEDULED', availableFrom: new Date(Date.now() + DAY), notifiedAt: null });
    expect(await code(getAssignment(as(ids.s1, 'STUDENT'), future))).toBe('NOT_FOUND');
    const studentView = await listCourseAssignments(as(ids.s1, 'STUDENT'), ids.course);
    expect(studentView.view).toBe('student');
    expect(studentView.items.some((r) => ('assignment' in r ? r.assignment.id : r.id) === future)).toBe(false);
    expect(await code(submit(as(ids.s1, 'STUDENT'), future, { text: 'x', fileIds: [] }))).toBe('NOT_FOUND');
    // Managers still see it.
    expect((await listCourseAssignments(T(), ids.course)).items.some((r) => 'id' in r && r.id === future)).toBe(true);

    const due = await mkAssignment({ status: 'SCHEDULED', availableFrom: new Date(Date.now() - 1000), notifiedAt: null });
    const row = await prisma.assignment.findUniqueOrThrow({ where: { id: due } });
    expect(row.status).toBe('SCHEDULED'); // no job rewrites status
    expect((await getAssignment(as(ids.s1, 'STUDENT'), due)).assignment.id).toBe(due);
    await publishOnce(due); // the read path fires this fire-and-forget; await it directly to observe
    await publishOnce(due);
    expect(await published(ids.s1, due)).toBe(1);
    expect((await prisma.assignment.findUniqueOrThrow({ where: { id: due } })).status).toBe('SCHEDULED');
  });

  it('FR-51/FR-52: DELETE hard-deletes without submissions, archives with them; archived is hidden from students', async () => {
    const empty = await mkAssignment();
    expect((await deleteOrArchiveAssignment(T(), empty)).result).toBe('deleted');
    expect(await prisma.assignment.findUnique({ where: { id: empty } })).toBeNull();

    const used = await mkAssignment();
    await submit(as(ids.s1, 'STUDENT'), used, { text: 'x', fileIds: [] });
    expect((await deleteOrArchiveAssignment(T(), used)).result).toBe('archived');
    expect(await code(getAssignment(as(ids.s1, 'STUDENT'), used))).toBe('NOT_FOUND');
    expect(await code(submit(as(ids.s2, 'STUDENT'), used, { text: 'x', fileIds: [] }))).toBe('NOT_FOUND');
    expect((await listMyAssignments(as(ids.s1, 'STUDENT'), {})).items.some((r) => r.assignment.id === used)).toBe(false);
    expect((await getAssignment(T(), used)).canManage).toBe(true);
    // Students cannot delete.
    expect(await code(deleteOrArchiveAssignment(as(ids.s1, 'STUDENT'), await mkAssignment()))).toBe('FORBIDDEN');
  });

  it('FR-15: duplicate copies as DRAFT with the same due date and a fresh rubric; only to managed courses', async () => {
    const rubric = [
      { title: 'A', maxPoints: 12, levels: [{ label: 'Full', points: 12 }] },
      { title: 'B', maxPoints: 8, levels: [{ label: 'Full', points: 8 }] },
    ];
    const src = await createAssignment(T(), ids.course, input({ rubric, instructions: '# Hi' }));
    const { created } = await duplicateAssignment(T(), src.id, [ids.course2]);
    expect(created).toHaveLength(1);
    const copy = await getAssignment(T(), created[0].assignmentId);
    expect(copy.assignment).toMatchObject({ status: 'DRAFT', courseId: ids.course2, dueAt: src.dueAt, instructions: '# Hi', maxPoints: '20.00' });
    expect(copy.assignment.rubric?.map((c) => c.title)).toEqual(['A', 'B']);
    expect(copy.assignment.rubric?.[0].id).not.toBe(src.rubric?.[0].id);
    expect(await code(duplicateAssignment(T(), src.id, [ids.other]))).toBe('FORBIDDEN');
  });

  it('NFR-4/FR-55/FR-57: no cross-student access; history only for managers; parent child must be linked', async () => {
    const a = await mkAssignment();
    await submit(as(ids.s1, 'STUDENT'), a, { text: 'v1', fileIds: [] });
    const { submission } = await submit(as(ids.s1, 'STUDENT'), a, { text: 'v2', fileIds: [] });

    expect(await code(getSubmission(as(ids.s2, 'STUDENT'), submission.id))).toBe('NOT_FOUND');
    expect(await code(getSubmission(as(ids.parent2, 'PARENT'), submission.id))).toBe('NOT_FOUND');
    expect(await code(getSubmission(as(ids.teacher2, 'TEACHER'), submission.id))).toBe('NOT_FOUND');
    expect((await getSubmission(as(ids.s1, 'STUDENT'), submission.id)).history).toBeUndefined();
    expect((await getSubmission(as(ids.parent, 'PARENT'), submission.id)).history).toBeUndefined();
    const mgr = await getSubmission(T(), submission.id);
    expect(mgr.history?.map((h) => h.text)).toEqual(['v1']);

    // s2 viewing the assignment sees only their own (empty) submission.
    expect((await getAssignment(as(ids.s2, 'STUDENT'), a)).submission).toBeNull();
    expect(await code(getAssignment(as(ids.s1, 'STUDENT'), a, ids.s2))).toBe('FORBIDDEN');
    expect(await code(listMyAssignments(as(ids.parent, 'PARENT'), { studentId: ids.s2 }))).toBe('FORBIDDEN');
    expect((await listMyAssignments(as(ids.parent, 'PARENT'), { studentId: ids.s1 })).studentId).toBe(ids.s1);
    // Not enrolled → cannot view the course or submit.
    expect(await code(getAssignment(as(ids.s3, 'STUDENT'), a))).not.toBe('OK');
    expect(await code(submit(as(ids.s3, 'STUDENT'), a, { text: 'x', fileIds: [] }))).toBe('FORBIDDEN');
  });

  it('NFR-5: only course managers can grade or read the roster', async () => {
    const a = await mkAssignment();
    const { submission } = await submit(as(ids.s1, 'STUDENT'), a, { text: 'x', fileIds: [] });
    const grade = { rawScore: '10.00', penaltyPercent: '0.00', return: false };
    expect(await code(gradeSubmission(as(ids.s1, 'STUDENT'), submission.id, grade))).toBe('FORBIDDEN');
    expect(await code(gradeSubmission(as(ids.teacher2, 'TEACHER'), submission.id, grade))).toBe('FORBIDDEN');
    expect(await code(listGradingRoster(as(ids.s1, 'STUDENT'), a, { sort: 'name' }, { skip: 0, take: 100 }))).toBe('FORBIDDEN');
    expect(await code(updateAssignment(as(ids.teacher2, 'TEACHER'), a, { title: 'hijack' }))).toBe('FORBIDDEN');
  });

  it('FR-54: roster lists every enrolled student, including non-submitters', async () => {
    const a = await mkAssignment();
    await submit(as(ids.s1, 'STUDENT'), a, { text: 'x', fileIds: [] });
    const { items, total } = await listGradingRoster(T(), a, { sort: 'name' }, { skip: 0, take: 100 });
    expect(total).toBe(2);
    const chip = Object.fromEntries(items.map((r) => [r.student.id, r.chipStatus]));
    expect(chip).toEqual({ [ids.s1]: 'SUBMITTED', [ids.s2]: 'NOT_SUBMITTED' });
  });

  it('FR-39: teacher "To grade" is submitted+ungraded, oldest first, own courses only', async () => {
    const a = await mkAssignment();
    const first = (await submit(as(ids.s2, 'STUDENT'), a, { text: 'x', fileIds: [] })).submission;
    await new Promise((r) => setTimeout(r, 20));
    const second = (await submit(as(ids.s1, 'STUDENT'), a, { text: 'y', fileIds: [] })).submission;
    const mine = (await listMyAssignments(T(), { courseId: ids.course })) as { view: string; items: { submissionId: string }[] };
    const order = mine.items.map((i) => i.submissionId).filter((sid) => sid === first.id || sid === second.id);
    expect(order).toEqual([first.id, second.id]);
    await gradeSubmission(T(), first.id, { rawScore: '5.00', penaltyPercent: '0.00', return: false });
    const after = (await listMyAssignments(T(), { courseId: ids.course })) as { items: { submissionId: string }[] };
    expect(after.items.some((i) => i.submissionId === first.id)).toBe(false);
    const other = (await listMyAssignments(as(ids.teacher2, 'TEACHER'), {})) as { items: { submissionId: string }[] };
    expect(other.items.some((i) => i.submissionId === second.id)).toBe(false);
  });

  it('FR-14: changing max points keeps existing scores', async () => {
    const a = await mkAssignment();
    const { submission } = await submit(as(ids.s1, 'STUDENT'), a, { text: 'x', fileIds: [] });
    await gradeSubmission(T(), submission.id, { rawScore: '18.00', penaltyPercent: '20.00', return: false });
    const res = await updateAssignment(T(), a, { maxPoints: '40.00' });
    expect(res.maxPoints).toBe('40.00');
    expect(res.submissionCount).toBe(1);
    const after = await getSubmission(T(), submission.id);
    expect(after).toMatchObject({ rawScore: '18.00', finalScore: '14.40' });
  });
});
