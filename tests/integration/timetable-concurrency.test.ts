// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Point the shared Prisma client and env at the test DB before any app module loads.
vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DATABASE_URL ??= 'postgresql://unused@localhost/unused';
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.AUTH_SECRET ??= 'test-secret';
});

import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import {
  assertCanViewTimetable,
  createSlot,
  deletePeriod,
  deleteSlot,
  getAvailability,
  getCurrentSlot,
  getFreeRooms,
  getScheduleForDate,
  moveSlot,
  resolvePersonalTarget,
  updateSchoolDays,
  validateSlot,
} from '@/server/timetable/timetable-service';

/**
 * PRD-06 service against a real Postgres (NFR-1, NFR-12, FR-7..FR-14, FR-30,
 * FR-31, FR-35, FR-37, FR-38, FR-40, FR-45). Every fixture is tagged with
 * MARK and removed afterwards. SchoolDay and the school timezone are global,
 * so they are snapshotted and restored.
 */
const MARK = 'qa-sh6';
const email = (n: string) => `${n}@${MARK}.test`;
const startedAt = new Date();

let yearId: string;
let tz0: string;
let days0: { dayOfWeek: number; isTeaching: boolean }[];
const ids = {} as Record<string, string>;

async function expectConflict(p: Promise<unknown>) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe('CONFLICT');
  return err as AppError & { details: { clashes?: { rule: string; message: string }[]; slotCount?: number } };
}

async function cleanup() {
  const courses = await prisma.course.findMany({ where: { code: { startsWith: 'QA6-' } }, select: { id: true } });
  const courseIds = courses.map((c) => c.id);
  await prisma.timetableSlot.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.enrollment.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
  await prisma.section.deleteMany({ where: { name: { startsWith: 'QA6-' } } });
  await prisma.room.deleteMany({ where: { name: { startsWith: 'QA6-' } } });
  await prisma.period.deleteMany({ where: { name: { startsWith: 'QA6-' } } });
  const users = await prisma.user.findMany({ where: { email: { endsWith: `@${MARK}.test` } }, select: { id: true } });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { actorId: { in: users.map((u) => u.id) } },
        { entityType: { in: ['TimetableSlot', 'SchoolDay', 'Period'] }, createdAt: { gte: startedAt } },
      ],
    },
  });
  await prisma.parentStudentLink.deleteMany({ where: { parent: { email: { endsWith: `@${MARK}.test` } } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${MARK}.test` } } });
}

describe.runIf(process.env.TEST_DATABASE_URL)('timetable service (integration)', () => {
  beforeAll(async () => {
    await cleanup();
    const year = await prisma.academicYear.findFirstOrThrow({ where: { isCurrent: true } });
    yearId = year.id;
    const settings = await prisma.schoolSettings.upsert({ where: { id: 'singleton' }, update: {}, create: {} });
    tz0 = settings.timezone;
    days0 = await prisma.schoolDay.findMany();
    // Kolkata (UTC+5:30) proves 'now' uses SchoolSettings.timezone, not the host's (FR-45).
    await prisma.schoolSettings.update({ where: { id: 'singleton' }, data: { timezone: 'Asia/Kolkata' } });
    for (let d = 1; d <= 7; d++) {
      await prisma.schoolDay.upsert({ where: { dayOfWeek: d }, update: { isTeaching: d <= 5 }, create: { dayOfWeek: d, isTeaching: d <= 5 } });
    }

    const mk = (n: string, role: 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT') =>
      prisma.user.create({ data: { email: email(n), firstName: n, lastName: 'Qa', role, status: 'ACTIVE' } });
    for (const [n, r] of [
      ['admin', 'ADMIN'], ['tom', 'TEACHER'], ['tina', 'TEACHER'], ['co', 'TEACHER'], ['other', 'TEACHER'],
      ['sam', 'STUDENT'], ['sue', 'STUDENT'], ['pat', 'PARENT'], ['solo', 'PARENT'],
    ] as const) ids[n] = (await mk(n, r)).id;

    await prisma.parentStudentLink.createMany({
      data: [
        { parentId: ids.pat, studentId: ids.sam, relationship: 'MOTHER' },
        { parentId: ids.pat, studentId: ids.sue, relationship: 'MOTHER' },
        { parentId: ids.solo, studentId: ids.sam, relationship: 'FATHER' },
      ],
    });

    ids.p1 = (await prisma.period.create({ data: { name: 'QA6-P1', startTime: '10:00', endTime: '10:45', order: 9001 } })).id;
    ids.p2 = (await prisma.period.create({ data: { name: 'QA6-P2', startTime: '10:50', endTime: '11:35', order: 9002 } })).id;
    ids.brk = (await prisma.period.create({ data: { name: 'QA6-Break', startTime: '11:35', endTime: '11:55', order: 9003, kind: 'BREAK' } })).id;

    ids.r1 = (await prisma.room.create({ data: { name: 'QA6-R1' } })).id;
    ids.r2 = (await prisma.room.create({ data: { name: 'QA6-R2' } })).id;

    const grade = await prisma.gradeLevel.findFirstOrThrow();
    const sec = (name: string, homeroomTeacherId?: string) =>
      prisma.section.create({ data: { name, academicYearId: yearId, gradeLevelId: grade.id, roomId: ids.r1, homeroomTeacherId } });
    ids.s7a = (await sec('QA6-7A', ids.tina)).id;
    ids.s7b = (await sec('QA6-7B')).id;

    const subj = await prisma.subject.findFirstOrThrow({ where: { code: 'MATH' } });
    const course = (code: string, teacherId: string, sectionId: string | null, coTeacherIds: string[] = []) =>
      prisma.course.create({
        data: { code, name: code, academicYearId: yearId, subjectId: subj.id, teacherId, sectionId, coTeacherIds },
      });
    ids.math7a = (await course('QA6-MATH-7A', ids.tom, ids.s7a)).id;
    ids.math7b = (await course('QA6-MATH-7B', ids.tom, ids.s7b)).id;
    ids.sci7a = (await course('QA6-SCI-7A', ids.tina, ids.s7a)).id;
    ids.coTaught = (await course('QA6-CO', ids.other, ids.s7b, [ids.co])).id;
    ids.coClash = (await course('QA6-CO2', ids.co, null)).id;
    ids.clubA = (await course('QA6-CLUBA', ids.other, null)).id;
    ids.clubB = (await course('QA6-CLUBB', ids.tina, null)).id;
    ids.race1 = (await course('QA6-RACE1', ids.tina, null)).id;
    ids.race2 = (await course('QA6-RACE2', ids.tina, null)).id;
    await prisma.enrollment.createMany({
      data: [
        { courseId: ids.clubA, studentId: ids.sam },
        { courseId: ids.clubB, studentId: ids.sam },
        { courseId: ids.clubA, studentId: ids.sue },
        { courseId: ids.clubB, studentId: ids.sue, status: 'DROPPED' },
        { courseId: ids.math7a, studentId: ids.sam },
      ],
    });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.schoolSettings.update({ where: { id: 'singleton' }, data: { timezone: tz0 } });
    await prisma.schoolDay.deleteMany({});
    if (days0.length) await prisma.schoolDay.createMany({ data: days0 });
    await prisma.$disconnect();
  });

  it('NFR-1/NFR-12: two concurrent conflicting inserts yield exactly one success', async () => {
    const results = await Promise.allSettled([
      createSlot({ courseId: ids.race1, dayOfWeek: 5, periodId: ids.p2 }),
      createSlot({ courseId: ids.race2, dayOfWeek: 5, periodId: ids.p2 }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const bad = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);
    expect((bad[0].reason as AppError).code).toBe('CONFLICT');
    expect(await prisma.timetableSlot.count({ where: { courseId: { in: [ids.race1, ids.race2] } } })).toBe(1);
    await prisma.timetableSlot.deleteMany({ where: { courseId: { in: [ids.race1, ids.race2] } } });
  });

  it('FR-37/FR-40: create derives academicYearId and audits', async () => {
    const slot = await createSlot({ courseId: ids.math7a, dayOfWeek: 1, periodId: ids.p1, roomId: ids.r1 }, { actorId: ids.admin });
    ids.slotA = slot.id;
    expect(slot.academicYearId).toBe(yearId);
    expect(slot.course.code).toBe('QA6-MATH-7A');
    expect(await prisma.auditLog.count({ where: { action: 'timetableSlot.create', entityId: slot.id } })).toBe(1);
  });

  it('FR-9/FR-10/FR-14/FR-37: teacher + room clash returns ALL clashes, 409, saves nothing', async () => {
    const err = await expectConflict(createSlot({ courseId: ids.math7b, dayOfWeek: 1, periodId: ids.p1, roomId: ids.r1 }));
    const rules = err.details.clashes!.map((c) => c.rule).sort();
    expect(rules).toEqual(['ROOM', 'TEACHER']);
    expect(err.details.clashes!.find((c) => c.rule === 'TEACHER')!.message).toBe(
      'Clash: tom Qa already teaches QA6-MATH-7A on Monday, QA6-P1.',
    );
    expect(err.details.clashes!.find((c) => c.rule === 'ROOM')!.message).toBe(
      'Clash: QA6-R1 is used by QA6-MATH-7A on Monday, QA6-P1.',
    );
    expect(await prisma.timetableSlot.count({ where: { courseId: ids.math7b } })).toBe(0);
  });

  it('FR-11: section clash', async () => {
    const err = await expectConflict(createSlot({ courseId: ids.sci7a, dayOfWeek: 1, periodId: ids.p1 }));
    expect(err.details.clashes!.map((c) => c.rule)).toEqual(['SECTION']);
    expect(err.details.clashes![0].message).toBe('Clash: QA6-7A already has Mathematics on Monday, QA6-P1.');
  });

  it('FR-9: co-teacher clash queried via coTeacherIds has', async () => {
    await createSlot({ courseId: ids.coTaught, dayOfWeek: 2, periodId: ids.p1 });
    const clashes = await validateSlot({ courseId: ids.coClash, dayOfWeek: 2, periodId: ids.p1, roomId: null });
    expect(clashes.map((c) => c.rule)).toEqual(['TEACHER']);
  });

  it('FR-12: student overlap counts only ACTIVE enrollments in both', async () => {
    await createSlot({ courseId: ids.clubA, dayOfWeek: 3, periodId: ids.p2 });
    const clashes = await validateSlot({ courseId: ids.clubB, dayOfWeek: 3, periodId: ids.p2, roomId: null });
    expect(clashes).toEqual([
      { rule: 'STUDENT', message: 'Clash: 1 students in QA6-CLUBB also take QA6-CLUBA at this time.' },
    ]);
  });

  it('FR-13: non-CLASS period and non-teaching day are rejected', async () => {
    const err = await expectConflict(createSlot({ courseId: ids.race1, dayOfWeek: 6, periodId: ids.brk }));
    expect(err.details.clashes!.map((c) => c.message)).toEqual([
      "Period 'QA6-Break' is not a class period.",
      'Saturday is not a teaching day.',
    ]);
  });

  it('FR-14/FR-18: PATCH excludes the moving slot itself and detects clashes at the target', async () => {
    const same = await moveSlot(ids.slotA, { roomId: ids.r2 }, { actorId: ids.admin });
    expect(same.roomId).toBe(ids.r2);
    const moved = await moveSlot(ids.slotA, { dayOfWeek: 4 }, { actorId: ids.admin });
    expect(moved.dayOfWeek).toBe(4);
    expect(await prisma.auditLog.count({ where: { action: 'timetableSlot.update', entityId: ids.slotA } })).toBe(2);
    // Moving onto a cell where Tom already teaches MATH-7B -> TEACHER clash.
    const b = await createSlot({ courseId: ids.math7b, dayOfWeek: 2, periodId: ids.p2 });
    await expectConflict(moveSlot(ids.slotA, { dayOfWeek: 2, periodId: ids.p2 }));
    await deleteSlot(b.id);
  });

  it('FR-21: free rooms exclude rooms used at that cell', async () => {
    const free = await getFreeRooms({ dayOfWeek: 4, periodId: ids.p1, academicYearId: yearId });
    const names = free.map((r) => r.name);
    expect(names).toContain('QA6-R1');
    expect(names).not.toContain('QA6-R2');
    const withSelf = await getFreeRooms({ dayOfWeek: 4, periodId: ids.p1, academicYearId: yearId, excludeSlotId: ids.slotA });
    expect(withSelf.map((r) => r.name)).toContain('QA6-R2');
  });

  it('FR-36: availability map keys clashing cells as "<day>-<periodId>"', async () => {
    const map = await getAvailability(ids.math7b);
    expect(map[`4-${ids.p1}`]).toEqual(['Clash: tom Qa already teaches QA6-MATH-7A on Thursday, QA6-P1.']);
    expect(map[`1-${ids.p1}`]).toBeUndefined();
  });

  it('FR-8: deleting a period with slots is 409 with the slot count', async () => {
    const err = await expectConflict(deletePeriod(ids.p1));
    expect(err.details.slotCount).toBeGreaterThan(0);
    expect(err.message).toMatch(/\d+ timetable slots/);
  });

  it('FR-30/FR-31/FR-45: schedule for date and current slot use the school timezone', async () => {
    // Thursday 2026-11-05 04:50 UTC = 10:20 in Asia/Kolkata -> inside QA6-P1 (10:00–10:45).
    const now = new Date('2026-11-05T04:50:00Z');
    const sched = await getScheduleForDate({ userId: ids.tom, role: 'TEACHER' }, now);
    expect(sched.map((s) => [s.period.name, s.course.code, s.room?.name])).toEqual([['QA6-P1', 'QA6-MATH-7A', 'QA6-R2']]);
    const studentSched = await getScheduleForDate({ userId: ids.sam, role: 'STUDENT' }, now);
    expect(studentSched.map((s) => s.course.code)).toEqual(['QA6-MATH-7A']);
    expect((await getCurrentSlot({ userId: ids.tom, role: 'TEACHER' }, now))?.course.code).toBe('QA6-MATH-7A');
    // 10:45 Kolkata is the exclusive end -> null.
    expect(await getCurrentSlot({ userId: ids.tom, role: 'TEACHER' }, new Date('2026-11-05T05:15:00Z'))).toBeNull();
    // Saturday in Kolkata -> non-teaching -> [].
    expect(await getScheduleForDate({ userId: ids.tom, role: 'TEACHER' }, new Date('2026-11-07T05:00:00Z'))).toEqual([]);
  });

  it('FR-35: timetable view access', async () => {
    const tina = { id: ids.tina, role: 'TEACHER' as const };
    await expect(assertCanViewTimetable({ id: ids.admin, role: 'ADMIN' }, 'room', ids.r1)).resolves.toBeUndefined();
    await expect(assertCanViewTimetable(tina, 'teacher', ids.tina)).resolves.toBeUndefined();
    await expect(assertCanViewTimetable(tina, 'section', ids.s7a)).resolves.toBeUndefined();
    await expect(assertCanViewTimetable(tina, 'teacher', ids.tom)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(assertCanViewTimetable(tina, 'section', ids.s7b)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(assertCanViewTimetable({ id: ids.sam, role: 'STUDENT' }, 'section', ids.s7a)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('FR-38/FR-25: personal timetable target resolution', async () => {
    expect(await resolvePersonalTarget({ id: ids.sam, role: 'STUDENT' })).toEqual({ kind: 'student', studentId: ids.sam });
    await expect(resolvePersonalTarget({ id: ids.sam, role: 'STUDENT' }, ids.sue)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await resolvePersonalTarget({ id: ids.pat, role: 'PARENT' }, ids.sue)).toEqual({ kind: 'student', studentId: ids.sue });
    await expect(resolvePersonalTarget({ id: ids.pat, role: 'PARENT' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(resolvePersonalTarget({ id: ids.solo, role: 'PARENT' }, ids.sue)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await resolvePersonalTarget({ id: ids.solo, role: 'PARENT' })).toEqual({ kind: 'student', studentId: ids.sam });
    expect(await resolvePersonalTarget({ id: ids.admin, role: 'ADMIN' })).toBeNull();
  });

  it('FR-7/FR-40: turning off a day deletes its slots and audits the count', async () => {
    const before = await prisma.timetableSlot.count({ where: { dayOfWeek: 2 } });
    expect(before).toBeGreaterThan(0);
    const days = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ dayOfWeek: d, isTeaching: d <= 5 && d !== 2 }));
    const res = await updateSchoolDays(days, { actorId: ids.admin });
    expect(res.deletedSlotCount).toBe(before);
    expect(await prisma.timetableSlot.count({ where: { dayOfWeek: 2 } })).toBe(0);
    expect(res.days.find((d) => d.dayOfWeek === 2)!.isTeaching).toBe(false);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'schoolDay.update', actorId: ids.admin } });
    expect((log.metadata as { deletedSlotCount: number }).deletedSlotCount).toBe(before);
  });

  it('FR-18/FR-40: delete slot audits', async () => {
    await deleteSlot(ids.slotA, { actorId: ids.admin });
    expect(await prisma.timetableSlot.findUnique({ where: { id: ids.slotA } })).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'timetableSlot.delete', entityId: ids.slotA } })).toBe(1);
  });
});
