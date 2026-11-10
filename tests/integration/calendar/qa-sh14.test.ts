// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DATABASE_URL ??= 'postgresql://unused@localhost/unused';
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.AUTH_SECRET ??= 'test-secret';
});

import { prisma } from '@/server/db';
import {
  audienceWhereForUser,
  canTargetAudience,
  isUserInAudience,
  resolveAudienceUserIds,
  type AudienceRow,
} from '@/server/announcements/audience';

/**
 * SH-14 QA: the DB-backed pieces Dev shipped (TASK-2 schema, TASK-6 audience resolver) that
 * had no real-Postgres coverage. Checks resolveAudienceUserIds (audience → users) and
 * isUserInAudience / audienceWhereForUser (user → audiences) agree (R4 parity), plus the
 * schema constraints (composite RSVP PK, cascades, unique feed token hash).
 * Uses the existing current academic year and fixture rows tagged with MARK.
 * Skipped without TEST_DATABASE_URL.
 */
const MARK = 'qa-sh14';
type R = 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT';
type K = 'admin' | 'homeroom' | 't' | 'co' | 't3' | 's1' | 's2' | 's3' | 'p1' | 'p3';
const ROLES: Record<K, R> = {
  admin: 'ADMIN',
  homeroom: 'TEACHER',
  t: 'TEACHER',
  co: 'TEACHER',
  t3: 'TEACHER',
  s1: 'STUDENT',
  s2: 'STUDENT',
  s3: 'STUDENT',
  p1: 'PARENT',
  p3: 'PARENT',
};
const ids = {} as Record<K | 'grade' | 'grade2' | 'section' | 'course' | 'subject' | 'year', string>;
const user = (k: K) => ({ id: ids[k], role: ROLES[k] });
const keys = Object.keys(ROLES) as K[];
const row = (type: AudienceRow['type'], refId: string | null, s = true, p = true, t = true): AudienceRow => ({
  type,
  refId,
  includeStudents: s,
  includeParents: p,
  includeTeachers: t,
});

/** Fixture users the audience resolves to (resolver direction). */
async function resolved(a: AudienceRow): Promise<K[]> {
  const set = new Set(await resolveAudienceUserIds([a]));
  return keys.filter((k) => set.has(ids[k])).sort();
}
/** Fixture users whose own clauses match the audience (user direction). */
async function matched(a: AudienceRow): Promise<K[]> {
  const out: K[] = [];
  for (const k of keys) if (await isUserInAudience(user(k), [a])) out.push(k);
  return out.sort();
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('SH-14 QA (integration)', () => {
  beforeAll(async () => {
    const year = await prisma.academicYear.findFirst({ where: { isCurrent: true } });
    if (!year) throw new Error('needs a current academic year (npm run db:seed)');
    ids.year = year.id;
    for (const k of keys) {
      ids[k] = (
        await prisma.user.create({
          data: { email: `${k}@${MARK}.test`, firstName: `Qa${k}`, lastName: 'Zz', role: ROLES[k], status: 'ACTIVE' },
        })
      ).id;
    }
    const maxOrder = (await prisma.gradeLevel.aggregate({ _max: { order: true } }))._max.order ?? 0;
    ids.grade = (await prisma.gradeLevel.create({ data: { name: `${MARK}-g`, shortName: `${MARK}-g`, order: maxOrder + 101 } })).id;
    ids.grade2 = (await prisma.gradeLevel.create({ data: { name: `${MARK}-g2`, shortName: `${MARK}-g2`, order: maxOrder + 102 } })).id;
    const profile = (k: K, gradeLevelId: string) =>
      prisma.studentProfile.create({
        data: { userId: ids[k], admissionNumber: `${MARK}-${k}`, dateOfBirth: new Date('2013-01-01'), gradeLevelId, enrollmentDate: new Date('2026-08-01') },
      });
    await profile('s1', ids.grade);
    await profile('s2', ids.grade);
    await profile('s3', ids.grade2);
    ids.section = (
      await prisma.section.create({ data: { academicYearId: ids.year, gradeLevelId: ids.grade, name: MARK, homeroomTeacherId: ids.homeroom } })
    ).id;
    await prisma.sectionMember.create({ data: { sectionId: ids.section, studentId: ids.s1, academicYearId: ids.year } });
    ids.subject = (await prisma.subject.create({ data: { name: MARK, code: MARK.toUpperCase() } })).id;
    ids.course = (
      await prisma.course.create({
        data: { name: MARK, code: MARK, academicYearId: ids.year, subjectId: ids.subject, sectionId: ids.section, teacherId: ids.t, coTeacherIds: [ids.co] },
      })
    ).id;
    await prisma.enrollment.createMany({
      data: [
        { courseId: ids.course, studentId: ids.s1 },
        { courseId: ids.course, studentId: ids.s3, status: 'DROPPED' },
      ],
    });
    await prisma.parentStudentLink.create({ data: { parentId: ids.p1, studentId: ids.s1, relationship: 'MOTHER', isPrimary: true } });
    await prisma.parentStudentLink.create({ data: { parentId: ids.p3, studentId: ids.s3, relationship: 'FATHER', isPrimary: true } });
  });

  afterAll(async () => {
    const users = keys.map((k) => ids[k]).filter(Boolean);
    await prisma.calendarEvent.deleteMany({ where: { createdById: { in: users } } });
    await prisma.course.deleteMany({ where: { code: MARK } });
    await prisma.section.deleteMany({ where: { name: MARK, academicYearId: ids.year } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.gradeLevel.deleteMany({ where: { name: { startsWith: MARK } } });
    await prisma.subject.deleteMany({ where: { code: MARK.toUpperCase() } });
    await prisma.$disconnect();
  });

  it('FR-3: COURSE audience — active students, their parents, teacher + co-teacher; parity holds', async () => {
    const a = row('COURSE', ids.course);
    expect(await resolved(a)).toEqual(['co', 'p1', 's1', 't']); // s3 DROPPED, p3 its parent: excluded
    expect(await matched(a)).toEqual(await resolved(a));
  });

  it('FR-3: SECTION audience — members, parents, homeroom + section course teachers; parity holds', async () => {
    const a = row('SECTION', ids.section);
    expect(await resolved(a)).toEqual(['co', 'homeroom', 'p1', 's1', 't']);
    expect(await matched(a)).toEqual(await resolved(a));
  });

  it('FR-3/FR-37: GRADE_LEVEL "parents only" (e.g. Grade 7 parents) reaches parents, not students or teachers', async () => {
    const a = row('GRADE_LEVEL', ids.grade, false, true, false);
    expect(await resolved(a)).toEqual(['p1']);
    expect(await matched(a)).toEqual(['p1']);
    const all = row('GRADE_LEVEL', ids.grade);
    expect(await resolved(all)).toEqual(['co', 'p1', 's1', 's2', 't']);
    expect(await matched(all)).toEqual(await resolved(all));
  });

  it('FR-3: SCHOOL, STAFF and ROLE audiences; parity holds', async () => {
    expect(await resolved(row('SCHOOL', null))).toEqual([...keys].sort());
    expect(await matched(row('SCHOOL', null))).toEqual([...keys].sort());
    expect(await resolved(row('STAFF', null))).toEqual(['admin', 'co', 'homeroom', 't', 't3']);
    expect(await matched(row('STAFF', null))).toEqual(['admin', 'co', 'homeroom', 't', 't3']);
    expect(await resolved(row('ROLE', 'PARENT'))).toEqual(['p1', 'p3']);
    expect(await matched(row('ROLE', 'PARENT'))).toEqual(['p1', 'p3']);
    expect(await resolved(row('ROLE', 'NOT_A_ROLE'))).toEqual([]);
  });

  it('resolveAudienceUserIds dedupes across audiences and drops non-ACTIVE users', async () => {
    const ids1 = await resolveAudienceUserIds([row('COURSE', ids.course), row('SECTION', ids.section)]);
    expect(new Set(ids1).size).toBe(ids1.length);
    await prisma.user.update({ where: { id: ids.s1 }, data: { status: 'DISABLED' } });
    try {
      expect(await resolved(row('COURSE', ids.course))).not.toContain('s1');
    } finally {
      await prisma.user.update({ where: { id: ids.s1 }, data: { status: 'ACTIVE' } });
    }
  });

  it('FR-7: canTargetAudience against real rows — teacher, co-teacher, homeroom', async () => {
    expect(await canTargetAudience(user('t'), { type: 'COURSE', refId: ids.course })).toBe(true);
    expect(await canTargetAudience(user('co'), { type: 'COURSE', refId: ids.course })).toBe(true);
    expect(await canTargetAudience(user('t3'), { type: 'COURSE', refId: ids.course })).toBe(false);
    expect(await canTargetAudience(user('homeroom'), { type: 'SECTION', refId: ids.section })).toBe(true);
    expect(await canTargetAudience(user('t'), { type: 'SECTION', refId: ids.section })).toBe(false); // teaches there, not homeroom
    expect(await canTargetAudience(user('t'), { type: 'SCHOOL', refId: null })).toBe(false);
  });

  it('TASK-2 schema + audienceWhereForUser: SQL filter, RSVP composite PK, cascades, unique token hash', async () => {
    const ev = await prisma.calendarEvent.create({
      data: {
        title: `${MARK} evening`,
        category: 'MEETING',
        startAt: new Date('2026-11-24T23:00:00Z'),
        endAt: new Date('2026-11-25T01:00:00Z'),
        rsvpEnabled: true,
        rsvpDeadline: new Date('2026-11-23T23:00:00Z'),
        createdById: ids.admin,
        audiences: { create: [row('GRADE_LEVEL', ids.grade, false, true, false)] },
      },
    });
    expect(ev.recurrence).toBe('NONE');
    expect(ev.isNoSchool).toBe(false);

    // user → events in SQL; the parent filter narrows to selected children
    const visible = async (k: K, studentIds?: string[]) =>
      (
        await prisma.calendarEvent.findMany({
          where: { id: ev.id, audiences: { some: await audienceWhereForUser(user(k), { studentIds }) } },
          select: { id: true },
        })
      ).length;
    expect(await visible('p1')).toBe(1);
    expect(await visible('p1', [ids.s2])).toBe(0); // not p1's child
    expect(await visible('s1')).toBe(0);
    expect(await visible('p3')).toBe(0);

    await prisma.eventRsvp.create({ data: { eventId: ev.id, userId: ids.p1, response: 'YES', guests: 2 } });
    await expect(prisma.eventRsvp.create({ data: { eventId: ev.id, userId: ids.p1, response: 'NO' } })).rejects.toMatchObject({ code: 'P2002' });

    await prisma.calendarFeedToken.create({ data: { userId: ids.p1, tokenHash: `${MARK}-hash` } });
    await expect(prisma.calendarFeedToken.create({ data: { userId: ids.p3, tokenHash: `${MARK}-hash` } })).rejects.toMatchObject({ code: 'P2002' });
    await prisma.calendarFeedToken.delete({ where: { userId: ids.p1 } });

    await prisma.calendarEvent.delete({ where: { id: ev.id } });
    expect(await prisma.eventAudience.count({ where: { eventId: ev.id } })).toBe(0);
    expect(await prisma.eventRsvp.count({ where: { eventId: ev.id } })).toBe(0);
  });
});
