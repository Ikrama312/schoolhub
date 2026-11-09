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
import { schoolNow } from '@/lib/dates';
import { toCsv } from '@/server/csv';
import {
  getBelowThreshold,
  getCourseMatrix,
  getOverview,
  getReport,
  getStudentAttendance,
  getToday,
  remindTeacher,
  saveRegister,
} from '@/server/attendance/attendance-service';
import { addDays, schoolToday } from '@/server/attendance/attendance-rules';

/**
 * SH-7 QA: behaviour the Dev suite (attendance-service.test.ts) does not cover.
 * Fixtures hang off the CURRENT academic year (the admin views only read that
 * one), are tagged with MARK and are removed in afterAll.
 */
const MARK = 'qa7x';
const email = (n: string) => `${n}@${MARK}.test`;
const ids: Record<string, string> = {};
const created = { users: [] as string[], periods: [] as string[], courses: [] as string[] };
let today: string;
let tz: string;
const T = () => ({ id: ids.teacher, role: 'TEACHER' as const });
const A = () => ({ id: ids.admin, role: 'ADMIN' as const });
const key = (date = today) => ({ courseId: ids.course, periodId: ids.period, date });
const recs = (s1: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED', s2: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED' = 'PRESENT') => [
  { studentId: ids.s1, status: s1, ...(s1 === 'LATE' ? { minutesLate: 7 } : {}), note: 'qa note' },
  { studentId: ids.s2, status: s2, ...(s2 === 'LATE' ? { minutesLate: 7 } : {}) },
];

async function code(p: Promise<unknown>) {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return e instanceof AppError ? e.code : (e as Error).message;
  }
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('attendance QA (SH-7)', () => {
  beforeAll(async () => {
    tz = (await prisma.schoolSettings.findUnique({ where: { id: 'singleton' } }))?.timezone ?? 'UTC';
    today = schoolToday(new Date(), tz);
    const year = await prisma.academicYear.findFirst({ where: { isCurrent: true } });
    if (!year) throw new Error('QA needs a current academic year');
    ids.year = year.id;

    const mk = async (n: string, role: 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT', lastName = n) => {
      const u = await prisma.user.create({ data: { email: email(n), firstName: 'QA', lastName, role, status: 'ACTIVE' } });
      created.users.push(u.id);
      return u.id;
    };
    ids.teacher = await mk('teacher', 'TEACHER');
    ids.admin = await mk('admin', 'ADMIN');
    ids.s1 = await mk('s1', 'STUDENT', 'Aardvark');
    ids.s2 = await mk('s2', 'STUDENT', 'Bison');
    ids.gone = await mk('gone', 'STUDENT', 'Cobra');
    ids.parent = await mk('parent', 'PARENT');
    ids.stranger = await mk('stranger', 'PARENT');
    await prisma.parentStudentLink.create({ data: { parentId: ids.parent, studentId: ids.s1, relationship: 'MOTHER', isPrimary: true } });

    const order = 8000 + Math.floor(Math.random() * 900);
    ids.grade = (await prisma.gradeLevel.create({ data: { name: MARK, shortName: MARK, order } })).id;
    ids.subject = (await prisma.subject.create({ data: { name: MARK, code: MARK.toUpperCase() } })).id;
    ids.period = (await prisma.period.create({ data: { name: 'QA P1', startTime: '00:00', endTime: '23:59', order } })).id;
    created.periods.push(ids.period);
    ids.section = (await prisma.section.create({ data: { name: `${MARK}-7Q`, academicYearId: ids.year, gradeLevelId: ids.grade, homeroomTeacherId: ids.teacher } })).id;
    ids.course = (
      await prisma.course.create({
        data: { name: 'QA Maths', code: MARK, academicYearId: ids.year, subjectId: ids.subject, sectionId: ids.section, teacherId: ids.teacher },
      })
    ).id;
    created.courses.push(ids.course);
    const longAgo = new Date(Date.now() - 60 * 86_400_000);
    await prisma.enrollment.createMany({
      data: [
        { courseId: ids.course, studentId: ids.s1, enrolledAt: longAgo },
        { courseId: ids.course, studentId: ids.s2, enrolledAt: longAgo },
        // Active until 3 days ago: on the register 5 days ago, then DROPPED.
        { courseId: ids.course, studentId: ids.gone, enrolledAt: longAgo, status: 'DROPPED', droppedAt: new Date(Date.now() - 3 * 86_400_000) },
      ],
    });
    await prisma.sectionMember.createMany({ data: [ids.s1, ids.s2].map((studentId) => ({ sectionId: ids.section, studentId, academicYearId: ids.year })) });
    const { isoDay } = schoolNow(new Date(), tz);
    ids.isoDay = String(isoDay);
    await prisma.timetableSlot.create({ data: { academicYearId: ids.year, courseId: ids.course, dayOfWeek: isoDay, periodId: ids.period } });
  });

  afterAll(async () => {
    await prisma.attendanceSession.deleteMany({ where: { OR: [{ courseId: { in: created.courses } }, { sectionId: ids.section }] } });
    await prisma.timetableSlot.deleteMany({ where: { courseId: { in: created.courses } } });
    await prisma.enrollment.deleteMany({ where: { courseId: { in: created.courses } } });
    await prisma.sectionMember.deleteMany({ where: { sectionId: ids.section } });
    await prisma.course.deleteMany({ where: { id: { in: created.courses } } });
    await prisma.section.deleteMany({ where: { id: ids.section } });
    await prisma.period.deleteMany({ where: { id: { in: created.periods } } });
    await prisma.subject.deleteMany({ where: { id: ids.subject } });
    await prisma.gradeLevel.deleteMany({ where: { id: ids.grade } });
    await prisma.emailOutbox.deleteMany({ where: { toEmail: { endsWith: `@${MARK}.test` } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: created.users } } });
    await prisma.user.deleteMany({ where: { id: { in: created.users } } });
    await prisma.$disconnect();
  });

  it('FR-6: landing lists today\'s meeting as Not taken, then Taken by the teacher', async () => {
    const before = await getToday(T());
    const m = before.meetings.find((x) => x.courseId === ids.course);
    if (Number(ids.isoDay) > 5) return; // weekend: no teaching schedule by default
    expect(m).toMatchObject({ periodId: ids.period, courseName: 'QA Maths', taken: null, isCurrent: true });
  });

  it('FR-30/31: overview counts expected vs taken and lists the missing register; remind notifies the teacher', async () => {
    if (Number(ids.isoDay) > 5) return;
    const o = await getOverview();
    expect(o.expected).toBeGreaterThanOrEqual(1);
    const missing = o.missing.find((x) => x.courseId === ids.course);
    if (schoolNow(new Date(), tz).hhmm >= '00:15') expect(missing?.teacher.id).toBe(ids.teacher);
    const r = await remindTeacher(A(), { courseId: ids.course, periodId: ids.period, date: today });
    expect(r.reminded.id).toBe(ids.teacher);
    const n = await prisma.notification.findFirst({ where: { userId: ids.teacher, type: 'attendance.register_missing' } });
    expect(n?.link).toBe(`/attendance/take/${ids.course}?date=${today}&periodId=${ids.period}`);
  });

  it('FR-21 + NFR-5: absence notification wording, link and queued email', async () => {
    await saveRegister(T(), key(), recs('ABSENT'));
    const n = await prisma.notification.findFirst({ where: { userId: ids.parent, type: 'attendance.absent' } });
    expect(n?.title).toBe('QA Aardvark was marked absent');
    expect(n?.body).toMatch(/^QA Maths – qa7x-7Q, QA P1, \w+day \d{1,2} \w{3} \d{4}$/);
    expect(n?.link).toBe(`/students/${ids.s1}/attendance`);
    expect(await prisma.emailOutbox.count({ where: { toEmail: email('parent') } })).toBeGreaterThanOrEqual(1);
  });

  it('FR-22: at most one absence notification per student per session (A → P → A)', async () => {
    await saveRegister(T(), key(), recs('PRESENT')); // corrected
    await saveRegister(T(), key(), recs('ABSENT')); // absent again, same session
    const absent = await prisma.notification.count({ where: { userId: ids.parent, type: 'attendance.absent' } });
    expect(absent).toBe(1);
  });

  it('FR-10/FR-19: a teacher can still save a register that an admin marked EXCUSED (unchanged row)', async () => {
    await saveRegister(A(), key(), recs('EXCUSED'));
    // Teacher only changes s2; s1 stays EXCUSED exactly as the admin left it.
    expect(await code(saveRegister(T(), key(), recs('EXCUSED', 'LATE')))).toBe('OK');
  });

  it('FR-27 + NFR-7: notes stripped for parents; unlinked parents refused', async () => {
    const asTeacher = await getStudentAttendance(T(), ids.s1, {});
    expect(asTeacher.records.length).toBeGreaterThan(0);
    expect(asTeacher.records.every((r) => 'note' in r)).toBe(true);
    const asParent = await getStudentAttendance({ id: ids.parent, role: 'PARENT' }, ids.s1, {});
    expect(asParent.records.some((r) => 'note' in r)).toBe(false);
    const asStudent = await getStudentAttendance({ id: ids.s1, role: 'STUDENT' }, ids.s1, {});
    expect(asStudent.records.some((r) => 'note' in r)).toBe(false);
    // Platform convention (student-access.ts): STUDENT/PARENT get NOT_FOUND so existence isn't leaked.
    expect(await code(getStudentAttendance({ id: ids.stranger, role: 'PARENT' }, ids.s1, {}))).toBe('NOT_FOUND');
    expect(await code(getStudentAttendance({ id: ids.s2, role: 'STUDENT' }, ids.s1, {}))).toBe('NOT_FOUND');
  });

  it('FR-28/FR-29: DROPPED-enrollment records count toward the rate and appear in the course matrix', async () => {
    const d = addDays(today, -5);
    await saveRegister(T(), key(d), [
      { studentId: ids.s1, status: 'PRESENT' },
      { studentId: ids.s2, status: 'PRESENT' },
      { studentId: ids.gone, status: 'ABSENT' },
    ]);
    const gone = await getStudentAttendance(A(), ids.gone, { from: d, to: d });
    expect(gone.records).toHaveLength(1);
    expect(gone.summary.year).toMatchObject({ records: 1, absent: 1, rate: 0 });
    const matrix = await getCourseMatrix(T(), ids.course);
    const row = matrix.students.find((s) => s.studentId === ids.gone);
    expect(row?.enrollmentStatus).toBe('DROPPED');
    expect(row?.rate).toBe(0);
    expect(matrix.sessions.map((s) => s.date)).toEqual([d, today]); // oldest → newest
  });

  it('FR-32: report aggregates per student, status filter, CSV has the same columns', async () => {
    const rows = await getReport({ from: addDays(today, -10), to: today, courseId: ids.course });
    const s1 = rows.find((r) => r.studentId === ids.s1)!;
    expect(s1).toMatchObject({ records: 2, present: 1, excused: 1, rate: 100 });
    const absentOnly = await getReport({ from: addDays(today, -10), to: today, courseId: ids.course, status: 'ABSENT' });
    expect(absentOnly.map((r) => r.studentId)).toEqual([ids.gone]);
    const csv = toCsv([{ key: 'studentName', header: 'Student' }, { key: 'rate', header: 'Rate' }], absentOnly);
    expect(csv).toContain('QA Cobra');
  });

  it('FR-33: below-threshold lists YTD rate < threshold, ascending, linked', async () => {
    const { threshold, rows } = await getBelowThreshold();
    expect(threshold).toBe(90);
    const mine = rows.find((r) => r.studentId === ids.gone);
    expect(mine).toMatchObject({ rate: 0, href: `/students/${ids.gone}/attendance` });
    expect(rows.find((r) => r.studentId === ids.s1)).toBeUndefined(); // 100 %
    const rates = rows.map((r) => r.rate ?? 0);
    expect(rates).toEqual([...rates].sort((a, b) => a - b));
  });

  it('NFR-1: 35-student save < 500 ms; 1,200-record yearly tab < 400 ms', async () => {
    const order = 7000 + Math.floor(Math.random() * 900);
    const course = await prisma.course.create({
      data: { name: 'QA Perf', code: `${MARK}p`, academicYearId: ids.year, subjectId: ids.subject, teacherId: ids.teacher },
    });
    created.courses.push(course.id);
    const students = await Promise.all(
      Array.from({ length: 35 }, (_, i) =>
        prisma.user.create({ data: { email: email(`p${i}`), firstName: 'P', lastName: `P${String(i).padStart(2, '0')}`, role: 'STUDENT', status: 'ACTIVE' } }),
      ),
    );
    created.users.push(...students.map((s) => s.id));
    await prisma.enrollment.createMany({ data: students.map((s) => ({ courseId: course.id, studentId: s.id, enrolledAt: new Date(Date.now() - 90 * 86_400_000) })) });
    const k = { courseId: course.id, periodId: ids.period, date: today };
    await saveRegister(T(), k, students.map((s) => ({ studentId: s.id, status: 'PRESENT' as const }))); // warm-up
    const t0 = performance.now();
    await saveRegister(T(), k, students.map((s, i) => ({ studentId: s.id, status: i % 5 ? ('PRESENT' as const) : ('ABSENT' as const) })));
    const saveMs = performance.now() - t0;

    // 20 periods × 60 days = 1,200 records for one student, all inside the current year.
    const periods = await Promise.all(
      Array.from({ length: 20 }, (_, i) => prisma.period.create({ data: { name: `QA ${i}`, startTime: '01:00', endTime: '01:30', order: order + i } })),
    );
    created.periods.push(...periods.map((p) => p.id));
    const sessions = Array.from({ length: 60 }, (_, d) => addDays(today, -(d + 1))).flatMap((date) =>
      periods.map((p) => ({ courseId: course.id, periodId: p.id, date: new Date(`${date}T00:00:00Z`), takenById: ids.teacher, updatedById: ids.teacher })),
    );
    await prisma.attendanceSession.createMany({ data: sessions });
    const sessionIds = (await prisma.attendanceSession.findMany({ where: { courseId: course.id, periodId: { not: ids.period } }, select: { id: true } })).map((s) => s.id);
    expect(sessionIds).toHaveLength(1200);
    await prisma.attendanceRecord.createMany({ data: sessionIds.map((sessionId, i) => ({ sessionId, studentId: students[0].id, status: i % 17 ? 'PRESENT' : 'LATE' })) });

    await getStudentAttendance(A(), students[0].id, {}); // warm-up
    const t1 = performance.now();
    const tab = await getStudentAttendance(A(), students[0].id, {});
    const tabMs = performance.now() - t1;
    console.info(`[NFR-1] save35=${saveMs.toFixed(0)}ms tab1200=${tabMs.toFixed(0)}ms`);
    expect(tab.summary.year.records).toBe(1201);
    expect(saveMs).toBeLessThan(500);
    expect(tabMs).toBeLessThan(400);
  }, 60_000);
});
