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
import { schoolToday, addDays } from '@/server/attendance/attendance-rules';
import { schoolMidnight } from '@/lib/dates';
import { book, cancel, setAvailability } from '@/server/conferences/conferences-service';

/**
 * PRD-15 FR-46 / NFR-1: two parents race for one slot via Promise.all → exactly one
 * wins, the other gets 409 SLOT_TAKEN. Also FR-31 one-per-teacher-per-child (partial
 * unique index → 409 ONE_PER_TEACHER) and cancel by a non-booker (403).
 */
const MARK = 'qa-sh15-conf';
const email = (n: string) => `${n}@${MARK}.test`;
const ids = {} as Record<string, string>;
let slots: { id: string }[] = [];

async function code(p: Promise<unknown>) {
  try {
    await p;
    return { code: 'OK' };
  } catch (e) {
    if (e instanceof AppError) return { code: e.code, reason: (e.details as { reason?: string } | undefined)?.reason };
    throw e;
  }
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('conference booking (integration)', () => {
  beforeAll(async () => {
    const tz = (await prisma.schoolSettings.findUnique({ where: { id: 'singleton' } }))?.timezone ?? 'UTC';
    const date = addDays(schoolToday(new Date(), tz), 7);
    const mk = (n: string, role: 'TEACHER' | 'STUDENT' | 'PARENT') =>
      prisma.user.create({ data: { email: email(n), firstName: 'QA', lastName: n, role, status: 'ACTIVE' } }).then((u) => u.id);
    for (const [n, r] of [['teacher', 'TEACHER'], ['p1', 'PARENT'], ['p2', 'PARENT'], ['s1', 'STUDENT'], ['s2', 'STUDENT']] as const) ids[n] = await mk(n, r);
    const order = 9000 + Math.floor(Math.random() * 900);
    const year =
      (await prisma.academicYear.findFirst({ where: { isCurrent: true } })) ??
      (await prisma.academicYear.create({ data: { name: MARK, startDate: new Date('2026-01-01'), endDate: new Date('2027-12-31'), isCurrent: true } }));
    ids.grade = (await prisma.gradeLevel.create({ data: { name: MARK, shortName: MARK, order } })).id;
    ids.subject = (await prisma.subject.create({ data: { name: MARK, code: MARK.toUpperCase() } })).id;
    ids.section = (await prisma.section.create({ data: { name: MARK, academicYearId: year.id, gradeLevelId: ids.grade } })).id;
    ids.course = (await prisma.course.create({ data: { name: MARK, code: MARK, academicYearId: year.id, subjectId: ids.subject, sectionId: ids.section, teacherId: ids.teacher } })).id;
    for (const [s, p, n] of [[ids.s1, ids.p1, 'A1'], [ids.s2, ids.p2, 'A2']]) {
      await prisma.studentProfile.create({ data: { userId: s, admissionNumber: `${MARK}-${n}`, dateOfBirth: new Date('2014-01-01'), gradeLevelId: ids.grade, enrollmentDate: new Date('2026-08-17') } });
      await prisma.parentStudentLink.create({ data: { parentId: p, studentId: s, relationship: 'FATHER' } });
      await prisma.enrollment.create({ data: { courseId: ids.course, studentId: s } });
    }
    ids.event = (
      await prisma.conferenceEvent.create({
        data: {
          title: MARK,
          date: new Date(`${date}T00:00:00Z`),
          bookingOpensAt: new Date(Date.now() - 3_600_000),
          bookingClosesAt: schoolMidnight(date, tz),
          slotMinutes: 10,
          gradeLevelIds: [ids.grade],
          createdById: ids.teacher,
        },
      })
    ).id;
    const result = await setAvailability({ id: ids.teacher, role: 'TEACHER' }, ids.event, { ranges: [{ start: '15:00', end: '15:30' }] });
    slots = result.slots;
  });

  afterAll(async () => {
    const users = ['teacher', 'p1', 'p2', 's1', 's2'].map((k) => ids[k]).filter(Boolean);
    await prisma.conferenceEvent.deleteMany({ where: { id: ids.event } });
    await prisma.course.deleteMany({ where: { id: ids.course } });
    await prisma.section.deleteMany({ where: { id: ids.section } });
    await prisma.studentProfile.deleteMany({ where: { userId: { in: users } } });
    await prisma.subject.deleteMany({ where: { id: ids.subject } });
    await prisma.gradeLevel.deleteMany({ where: { id: ids.grade } });
    await prisma.academicYear.deleteMany({ where: { name: MARK } });
    await prisma.emailOutbox.deleteMany({ where: { toEmail: { endsWith: `@${MARK}.test` } } });
    await prisma.notification.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });

  it('generates 3 slots for 15:00–15:30 at 10 minutes', () => {
    expect(slots).toHaveLength(3);
  });

  it('NFR-1: two concurrent bookings of one slot → exactly one success, the other 409 SLOT_TAKEN', async () => {
    const results = await Promise.allSettled([
      book({ id: ids.p1, role: 'PARENT' }, slots[0].id, { studentId: ids.s1 }),
      book({ id: ids.p2, role: 'PARENT' }, slots[0].id, { studentId: ids.s2 }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(AppError);
    expect((rejected.reason as AppError).code).toBe('CONFLICT');
    expect(((rejected.reason as AppError).details as { reason: string }).reason).toBe('SLOT_TAKEN');
    expect(await prisma.conferenceSlot.count({ where: { eventId: ids.event, bookedByParentId: { not: null } } })).toBe(1);
  });

  it('FR-31: a second slot with the same teacher for the same child → 409 ONE_PER_TEACHER', async () => {
    const winner = await prisma.conferenceSlot.findFirstOrThrow({ where: { id: slots[0].id } });
    const [parent, student] = winner.bookedByParentId === ids.p1 ? [ids.p1, ids.s1] : [ids.p2, ids.s2];
    expect(await code(book({ id: parent, role: 'PARENT' }, slots[2].id, { studentId: student }))).toEqual({ code: 'CONFLICT', reason: 'ONE_PER_TEACHER' });
    const other = parent === ids.p1 ? ids.p2 : ids.p1;
    expect(await code(cancel({ id: other, role: 'PARENT' }, slots[0].id))).toEqual({ code: 'FORBIDDEN', reason: 'NOT_BOOKER' });
    expect(await code(cancel({ id: parent, role: 'PARENT' }, slots[0].id))).toEqual({ code: 'OK' });
  });
});
