// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Point the shared Prisma client and env at the test DB before any app module loads.
vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DATABASE_URL ??= 'postgresql://unused@localhost/unused';
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.AUTH_SECRET ??= 'test-secret';
});

import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import { getRegister, saveRegister } from '@/server/attendance/attendance-service';
import { addDays, schoolToday } from '@/server/attendance/attendance-rules';

/**
 * PRD-07 service against a real, migrated Postgres (FR-40; built with
 * `prisma migrate deploy`, never `db push`). Every fixture is tagged with
 * MARK and removed afterwards. Skipped without TEST_DATABASE_URL.
 */
const MARK = 'qa-sh7';
const email = (n: string) => `${n}@${MARK}.test`;

const ids = {} as Record<'year' | 'grade' | 'subject' | 'period' | 'section' | 'course' | 'teacher' | 'other' | 'admin' | 's1' | 's2' | 'late' | 'gone' | 'parent', string>;
let today: string;
const asTeacher = () => ({ id: ids.teacher, role: 'TEACHER' as const });
const asAdmin = () => ({ id: ids.admin, role: 'ADMIN' as const });
const courseKey = (date = today) => ({ courseId: ids.course, periodId: ids.period, date });
const all = (status: 'PRESENT' | 'ABSENT' | 'EXCUSED' = 'PRESENT') => [
  { studentId: ids.s1, status },
  { studentId: ids.s2, status: 'PRESENT' as const },
];

async function code(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return { code: e.code, details: e.details };
    if (e instanceof Prisma.PrismaClientKnownRequestError) return { code: e.code };
    return { code: (e as Error).message };
  }
  return { code: 'OK' };
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('attendance-service (integration)', () => {
  beforeAll(async () => {
    const tz = (await prisma.schoolSettings.findUnique({ where: { id: 'singleton' } }))?.timezone ?? 'UTC';
    today = schoolToday(new Date(), tz);
    const mk = (n: string, role: 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT', lastName = n) =>
      prisma.user.create({ data: { email: email(n), firstName: 'QA', lastName, role, status: 'ACTIVE' } }).then((u) => u.id);
    Object.assign(ids, {
      teacher: await mk('teacher', 'TEACHER'),
      other: await mk('other', 'TEACHER'),
      admin: await mk('admin', 'ADMIN'),
      s1: await mk('s1', 'STUDENT', 'Alpha'),
      s2: await mk('s2', 'STUDENT', 'Beta'),
      late: await mk('late', 'STUDENT', 'Gamma'),
      gone: await mk('gone', 'STUDENT', 'Delta'),
      parent: await mk('parent', 'PARENT'),
    });
    await prisma.parentStudentLink.create({ data: { parentId: ids.parent, studentId: ids.s1, relationship: 'MOTHER', isPrimary: true } });
    const order = 9000 + Math.floor(Math.random() * 900);
    ids.year = (await prisma.academicYear.create({ data: { name: MARK, startDate: new Date('2026-01-01'), endDate: new Date('2027-12-31') } })).id;
    ids.grade = (await prisma.gradeLevel.create({ data: { name: MARK, shortName: MARK, order } })).id;
    ids.subject = (await prisma.subject.create({ data: { name: MARK, code: MARK.toUpperCase() } })).id;
    ids.period = (await prisma.period.create({ data: { name: MARK, startTime: '23:00', endTime: '23:30', order } })).id;
    ids.section = (await prisma.section.create({ data: { name: MARK, academicYearId: ids.year, gradeLevelId: ids.grade, homeroomTeacherId: ids.teacher } })).id;
    ids.course = (
      await prisma.course.create({
        data: { name: MARK, code: MARK, academicYearId: ids.year, subjectId: ids.subject, sectionId: ids.section, teacherId: ids.teacher },
      })
    ).id;
    const longAgo = new Date(Date.now() - 60 * 86_400_000);
    await prisma.enrollment.createMany({
      data: [
        { courseId: ids.course, studentId: ids.s1, enrolledAt: longAgo },
        { courseId: ids.course, studentId: ids.s2, enrolledAt: longAgo },
        // NFR-3: enrolled after today -> not on today's register.
        { courseId: ids.course, studentId: ids.late, enrolledAt: new Date(Date.now() + 3 * 86_400_000) },
        // Dropped long before today -> not on today's register.
        { courseId: ids.course, studentId: ids.gone, enrolledAt: longAgo, status: 'DROPPED', droppedAt: new Date(Date.now() - 30 * 86_400_000) },
      ],
    });
    await prisma.sectionMember.createMany({
      data: [ids.s1, ids.s2].map((studentId) => ({ sectionId: ids.section, studentId, academicYearId: ids.year })),
    });
  });

  afterAll(async () => {
    const users = Object.entries(ids).filter(([k]) => ['teacher', 'other', 'admin', 's1', 's2', 'late', 'gone', 'parent'].includes(k)).map(([, v]) => v);
    await prisma.attendanceSession.deleteMany({ where: { OR: [{ courseId: ids.course }, { sectionId: ids.section }] } });
    await prisma.enrollment.deleteMany({ where: { courseId: ids.course } });
    await prisma.sectionMember.deleteMany({ where: { sectionId: ids.section } });
    await prisma.course.deleteMany({ where: { id: ids.course } });
    await prisma.section.deleteMany({ where: { id: ids.section } });
    await prisma.period.deleteMany({ where: { id: ids.period } });
    await prisma.subject.deleteMany({ where: { id: ids.subject } });
    await prisma.gradeLevel.deleteMany({ where: { id: ids.grade } });
    await prisma.academicYear.deleteMany({ where: { id: ids.year } });
    await prisma.emailOutbox.deleteMany({ where: { toEmail: { endsWith: `@${MARK}.test` } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });

  it('roster is the students active on the date (NFR-3, FR-9)', async () => {
    const reg = await getRegister(asTeacher(), courseKey());
    expect(reg.students.map((s) => s.id)).toEqual([ids.s1, ids.s2]); // sorted by last name
    expect(reg.sessionId).toBeNull();
    expect(reg.records).toEqual([]);
  });

  it('rejects off-roster or incomplete records and writes nothing (atomic save)', async () => {
    const bad = await code(saveRegister(asTeacher(), courseKey(), [...all(), { studentId: ids.late, status: 'PRESENT' }]));
    expect(bad).toEqual({ code: 'VALIDATION_ERROR', details: { invalidStudentIds: [ids.late] } });
    const partial = await code(saveRegister(asTeacher(), courseKey(), [{ studentId: ids.s1, status: 'PRESENT' }]));
    expect(partial).toEqual({ code: 'VALIDATION_ERROR', details: { missingStudentIds: [ids.s2] } });
    expect(await prisma.attendanceSession.count({ where: { courseId: ids.course } })).toBe(0);
  });

  it('EXCUSED is ADMIN-only (FR-10); other teachers are refused', async () => {
    expect((await code(saveRegister(asTeacher(), courseKey(), all('EXCUSED')))).code).toBe('FORBIDDEN');
    expect((await code(saveRegister({ id: ids.other, role: 'TEACHER' }, courseKey(), all()))).code).toBe('FORBIDDEN');
  });

  it('saves once, notifies on transition only (FR-14, FR-21, FR-22)', async () => {
    const reg = await saveRegister(asTeacher(), courseKey(), all('ABSENT'));
    expect(reg.sessionId).not.toBeNull();
    expect(reg.updatedBy?.id).toBe(ids.teacher);
    const absentFor = () => prisma.notification.count({ where: { userId: { in: [ids.s1, ids.parent] }, type: 'attendance.absent' } });
    expect(await absentFor()).toBe(2); // student + linked parent
    await saveRegister(asTeacher(), courseKey(), all('ABSENT')); // no change
    expect(await absentFor()).toBe(2);
    await saveRegister(asTeacher(), courseKey(), all('PRESENT'));
    expect(await prisma.notification.count({ where: { userId: ids.s1, type: 'attendance.corrected' } })).toBe(1);
    expect(await prisma.attendanceSession.count({ where: { courseId: ids.course } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { actorId: ids.teacher, action: 'attendance.record.update' } })).toBe(1);
  });

  it('teacher edit window is 14 days; admin can edit older registers (FR-8, FR-19)', async () => {
    expect((await code(saveRegister(asTeacher(), courseKey(addDays(today, -15)), all()))).code).toBe('FORBIDDEN');
    expect((await code(getRegister(asTeacher(), courseKey(addDays(today, -15))))).code).toBe('FORBIDDEN');
    expect((await code(saveRegister(asTeacher(), courseKey(addDays(today, 1)), all()))).code).toBe('VALIDATION_ERROR');
    expect((await code(saveRegister(asAdmin(), courseKey(addDays(today, -15)), all('EXCUSED')))).code).toBe('OK');
  });

  it('daily register: homeroom teacher only (FR-15)', async () => {
    const key = { sectionId: ids.section, date: today };
    expect((await code(saveRegister(asTeacher(), key, all()))).code).toBe('OK');
    expect((await code(getRegister({ id: ids.other, role: 'TEACHER' }, key))).code).toBe('FORBIDDEN');
  });

  it('DB: CHECK one-of(courseId, sectionId) and both partial unique indexes (FR-2, FR-3)', async () => {
    const base = { date: new Date(`${today}T00:00:00Z`), takenById: ids.admin, updatedById: ids.admin };
    const both = prisma.attendanceSession.create({ data: { ...base, courseId: ids.course, sectionId: ids.section, periodId: ids.period } });
    expect((await code(both)).code).not.toBe('OK');
    expect((await code(prisma.attendanceSession.create({ data: base }))).code).not.toBe('OK');
    // Both registers for `today` already exist from earlier tests.
    expect((await code(prisma.attendanceSession.create({ data: { ...base, courseId: ids.course, periodId: ids.period } }))).code).toBe('P2002');
    expect((await code(prisma.attendanceSession.create({ data: { ...base, sectionId: ids.section } }))).code).toBe('P2002');
  });
});
