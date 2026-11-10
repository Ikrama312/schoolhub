// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DATABASE_URL ??= 'postgresql://unused@localhost/unused';
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.AUTH_SECRET ??= 'test-secret';
});

import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import { getRegister, saveRegister } from '@/server/attendance/attendance-service';
import { schoolToday } from '@/server/attendance/attendance-rules';
import { review, submit } from '@/server/absence-notes/absence-notes-service';

/**
 * PRD-15 FR-46 integration: approval converts ABSENT → EXCUSED and leaves PRESENT
 * untouched (FR-23); an approved note pre-fills a register taken later and unlocks
 * EXCUSED for the teacher (FR-24, FR-25); attendance.absent is suppressed while a
 * PENDING note covers the student (FR-27). Fixtures tagged MARK, removed afterwards.
 */
const MARK = 'qa-sh15-abs';
const email = (n: string) => `${n}@${MARK}.test`;
const ids = {} as Record<string, string>;
let today = '';
const T = () => ({ id: ids.teacher, role: 'TEACHER' as const });
const P = () => ({ id: ids.parent, role: 'PARENT' as const });
const A = () => ({ id: ids.admin, role: 'ADMIN' as const });

async function code(p: Promise<unknown>) {
  try {
    await p;
    return { code: 'OK' };
  } catch (e) {
    if (e instanceof AppError) return { code: e.code, reason: (e.details as { reason?: string } | undefined)?.reason };
    throw e;
  }
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('absence note approval (integration)', () => {
  beforeAll(async () => {
    const tz = (await prisma.schoolSettings.findUnique({ where: { id: 'singleton' } }))?.timezone ?? 'UTC';
    today = schoolToday(new Date(), tz);
    const mk = (n: string, role: 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT') =>
      prisma.user.create({ data: { email: email(n), firstName: 'QA', lastName: n, role, status: 'ACTIVE' } }).then((u) => u.id);
    for (const [n, r] of [['teacher', 'TEACHER'], ['admin', 'ADMIN'], ['parent', 'PARENT'], ['s1', 'STUDENT'], ['s2', 'STUDENT'], ['s3', 'STUDENT']] as const) ids[n] = await mk(n, r);
    await prisma.parentStudentLink.createMany({
      data: [ids.s1, ids.s2].map((studentId) => ({ parentId: ids.parent, studentId, relationship: 'MOTHER' as const })),
    });
    const order = 9000 + Math.floor(Math.random() * 900);
    const year =
      (await prisma.academicYear.findFirst({ where: { isCurrent: true } })) ??
      (await prisma.academicYear.create({ data: { name: MARK, startDate: new Date('2026-01-01'), endDate: new Date('2027-12-31'), isCurrent: true } }));
    ids.year = year.id;
    ids.grade = (await prisma.gradeLevel.create({ data: { name: MARK, shortName: MARK, order } })).id;
    ids.subject = (await prisma.subject.create({ data: { name: MARK, code: MARK.toUpperCase() } })).id;
    ids.period = (await prisma.period.create({ data: { name: MARK, startTime: '23:00', endTime: '23:30', order } })).id;
    ids.section = (await prisma.section.create({ data: { name: MARK, academicYearId: year.id, gradeLevelId: ids.grade, homeroomTeacherId: ids.teacher } })).id;
    const course = (code: string) =>
      prisma.course.create({ data: { name: code, code, academicYearId: year.id, subjectId: ids.subject, sectionId: ids.section, teacherId: ids.teacher } }).then((c) => c.id);
    ids.course = await course(MARK);
    ids.course2 = await course(`${MARK}-2`);
    const longAgo = new Date(Date.now() - 60 * 86_400_000);
    await prisma.enrollment.createMany({
      data: [
        { courseId: ids.course, studentId: ids.s1, enrolledAt: longAgo },
        { courseId: ids.course, studentId: ids.s2, enrolledAt: longAgo },
        { courseId: ids.course2, studentId: ids.s2, enrolledAt: longAgo },
        { courseId: ids.course2, studentId: ids.s3, enrolledAt: longAgo },
      ],
    });
    await prisma.sectionMember.createMany({ data: [ids.s1, ids.s2, ids.s3].map((studentId) => ({ sectionId: ids.section, studentId, academicYearId: year.id })) });
  });

  afterAll(async () => {
    const users = ['teacher', 'admin', 'parent', 's1', 's2', 's3'].map((k) => ids[k]).filter(Boolean);
    await prisma.absenceNote.deleteMany({ where: { studentId: { in: users } } });
    await prisma.attendanceSession.deleteMany({ where: { OR: [{ courseId: { in: [ids.course, ids.course2] } }, { sectionId: ids.section }] } });
    await prisma.course.deleteMany({ where: { id: { in: [ids.course, ids.course2] } } });
    await prisma.sectionMember.deleteMany({ where: { sectionId: ids.section } });
    await prisma.section.deleteMany({ where: { id: ids.section } });
    await prisma.period.deleteMany({ where: { id: ids.period } });
    await prisma.subject.deleteMany({ where: { id: ids.subject } });
    await prisma.gradeLevel.deleteMany({ where: { id: ids.grade } });
    await prisma.academicYear.deleteMany({ where: { name: MARK } });
    await prisma.emailOutbox.deleteMany({ where: { toEmail: { endsWith: `@${MARK}.test` } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users } } });
    await prisma.notification.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });

  it('FR-27: attendance.absent is suppressed while a PENDING note covers the student', async () => {
    ids.note = (await submit(P(), { studentId: ids.s1, fromDate: today, toDate: today, partialDay: false, periodIds: [], reason: 'ILLNESS' })).id;
    // Daily register: s1 PRESENT (morning), course register: s1 ABSENT.
    await saveRegister(T(), { sectionId: ids.section, date: today }, [ids.s1, ids.s2, ids.s3].map((studentId) => ({ studentId, status: 'PRESENT' as const })));
    await saveRegister(T(), { courseId: ids.course, periodId: ids.period, date: today }, [
      { studentId: ids.s1, status: 'ABSENT' },
      { studentId: ids.s2, status: 'ABSENT' },
    ]);
    const absent = (userId: string) => prisma.notification.count({ where: { userId, type: 'attendance.absent' } });
    expect(await absent(ids.s1)).toBe(0); // covered by the PENDING note
    expect(await absent(ids.s2)).toBe(1); // not covered
  });

  it('FR-23: approval converts ABSENT → EXCUSED and leaves PRESENT untouched; second review → 409', async () => {
    const result = await review(T(), ids.note, { decision: 'APPROVED', reviewNote: 'Get well soon' });
    expect(result).toMatchObject({ recordsExcused: 1, recordsCreated: 0 });
    expect(result.note.status).toBe('APPROVED');
    const records = await prisma.attendanceRecord.findMany({ where: { studentId: ids.s1 }, select: { status: true, note: true, session: { select: { courseId: true } } } });
    expect(records.find((r) => r.session.courseId === ids.course)).toMatchObject({ status: 'EXCUSED', note: `Absence note #${ids.note}` });
    expect(records.find((r) => r.session.courseId === null)?.status).toBe('PRESENT');
    expect(await prisma.notification.count({ where: { userId: ids.parent, type: 'absence_note.reviewed' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: ids.note, action: 'absence_note.approve' } })).toBe(1);
    expect(await code(review(A(), ids.note, { decision: 'REJECTED', reviewNote: 'no' }))).toEqual({ code: 'CONFLICT', reason: 'ALREADY_REVIEWED' });
  });

  it('FR-24/FR-25: an approved note pre-fills a later register and unlocks EXCUSED only for covered students', async () => {
    const note = await submit(P(), { studentId: ids.s2, fromDate: today, toDate: today, partialDay: false, periodIds: [], reason: 'FAMILY' });
    await review(A(), note.id, { decision: 'APPROVED' });
    const key = { courseId: ids.course2, periodId: ids.period, date: today };
    const reg = await getRegister(T(), key);
    const s2 = reg.students.find((s) => s.id === ids.s2)!;
    const s3 = reg.students.find((s) => s.id === ids.s3)!;
    expect(s2).toMatchObject({ absenceNoteId: note.id, excusable: true, prefilled: true });
    expect(s3).toMatchObject({ absenceNoteId: null, excusable: false, prefilled: false });
    expect(
      await code(saveRegister(T(), key, [{ studentId: ids.s2, status: 'EXCUSED' }, { studentId: ids.s3, status: 'EXCUSED' }])),
    ).toEqual({ code: 'FORBIDDEN', reason: 'NO_APPROVED_NOTE' });
    expect(await code(saveRegister(T(), key, [{ studentId: ids.s2, status: 'EXCUSED' }, { studentId: ids.s3, status: 'PRESENT' }]))).toEqual({ code: 'OK' });
  });

  it('NFR-5: only the homeroom teacher or ADMIN can review', async () => {
    const note = await submit(P(), { studentId: ids.s1, fromDate: today, toDate: today, partialDay: true, periodIds: [ids.period], reason: 'OTHER' });
    expect(await code(review({ id: ids.parent, role: 'PARENT' }, note.id, { decision: 'APPROVED' }))).toEqual({ code: 'NOT_FOUND', reason: undefined });
    const other = await prisma.user.create({ data: { email: email('other'), firstName: 'QA', lastName: 'other', role: 'TEACHER', status: 'ACTIVE' } });
    ids.other = other.id;
    expect(await code(review({ id: other.id, role: 'TEACHER' }, note.id, { decision: 'APPROVED' }))).toEqual({ code: 'FORBIDDEN', reason: 'NOT_HOMEROOM' });
    await prisma.user.delete({ where: { id: other.id } });
  });
});
