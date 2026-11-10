// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DATABASE_URL ??= 'postgresql://unused@localhost/unused';
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.AUTH_SECRET ??= 'test-secret';
});

import { prisma } from '@/server/db';
import { currentTerm } from '@/server/dashboards/insights';
import { getStudentInsights, listAtRisk, recomputeRiskSnapshots } from '@/server/dashboards/risk';

/**
 * PRD-16 risk engine against the seeded current term (FR-27, FR-28, FR-32, FR-42, NFR-3).
 * Fixture levels are driven by missing work: 5 missing → HIGH, 3 → MEDIUM. Real Postgres.
 */
const MARK = 'qa-sh16-risk';
const DAY = 86_400_000;
const ids = { assignments: [] as string[] } as Record<'year' | 'term' | 'subject' | 't1' | 't2' | 'hi' | 'med' | 'lo' | 'section' | 'courseA' | 'courseB', string> & {
  assignments: string[];
};
const T1 = () => ({ id: ids.t1, role: 'TEACHER' as const });
const T2 = () => ({ id: ids.t2, role: 'TEACHER' as const });
const ADMIN = { id: 'risk-test-admin', role: 'ADMIN' as const };

const snap = (studentId: string) => prisma.studentRiskSnapshot.findUniqueOrThrow({ where: { studentId_termId: { studentId, termId: ids.term } } });
const notes = () => prisma.notification.count({ where: { userId: ids.t1, type: 'insights.student_high_risk' } });
const force = () => recomputeRiskSnapshots({ force: true });
/** hi: 5 missing (HIGH) ↔ 3 missing (MEDIUM) by toggling two exemptions. */
const setHi = async (level: 'HIGH' | 'MEDIUM') => {
  const two = ids.assignments.slice(0, 2);
  if (level === 'MEDIUM') await prisma.gradeExemption.createMany({ data: two.map((assignmentId) => ({ assignmentId, studentId: ids.hi })), skipDuplicates: true });
  else await prisma.gradeExemption.deleteMany({ where: { studentId: ids.hi, assignmentId: { in: two } } });
  await force();
};

describe.skipIf(!process.env.TEST_DATABASE_URL)('dashboards: risk engine (integration)', () => {
  beforeAll(async () => {
    const term = await currentTerm();
    if (!term) throw new Error('The seeded DB needs a current term');
    ids.term = term.id;
    ids.year = term.academicYearId;
    const mk = (n: string, role: 'TEACHER' | 'STUDENT') =>
      prisma.user.create({ data: { email: `${n}@${MARK}.test`, firstName: n, lastName: MARK, role, status: 'ACTIVE' } }).then((u) => u.id);
    Object.assign(ids, { t1: await mk('t1', 'TEACHER'), t2: await mk('t2', 'TEACHER'), hi: await mk('hi', 'STUDENT'), med: await mk('med', 'STUDENT'), lo: await mk('lo', 'STUDENT') });
    const gradeLevel = await prisma.gradeLevel.findFirstOrThrow();
    ids.section = (await prisma.section.create({ data: { academicYearId: ids.year, gradeLevelId: gradeLevel.id, name: MARK, homeroomTeacherId: ids.t1 } })).id;
    await prisma.sectionMember.createMany({ data: [ids.hi, ids.med].map((studentId) => ({ sectionId: ids.section, studentId, academicYearId: ids.year })) });
    ids.subject = (await prisma.subject.create({ data: { name: MARK, code: MARK.toUpperCase() } })).id;
    const course = (code: string, teacherId: string) =>
      prisma.course.create({ data: { name: code, code, academicYearId: ids.year, subjectId: ids.subject, teacherId } }).then((c) => c.id);
    ids.courseA = await course(`${MARK}-a`, ids.t1);
    ids.courseB = await course(`${MARK}-b`, ids.t2);
    await prisma.enrollment.createMany({
      data: [
        { courseId: ids.courseA, studentId: ids.hi },
        { courseId: ids.courseA, studentId: ids.med },
        { courseId: ids.courseB, studentId: ids.lo },
      ],
    });
    for (let i = 1; i <= 5; i++) {
      const a = await prisma.assignment.create({
        data: {
          courseId: ids.courseA,
          title: `${MARK} ${i}`,
          submissionType: 'ONLINE_TEXT',
          maxPoints: '10',
          dueAt: new Date(Date.now() - i * DAY),
          status: 'PUBLISHED',
          createdById: ids.t1,
        },
      });
      ids.assignments.push(a.id);
    }
    // med submitted two → 3 missing.
    await prisma.submission.createMany({
      data: ids.assignments.slice(3).map((assignmentId) => ({ assignmentId, studentId: ids.med, attemptNumber: 1, submittedAt: new Date() })),
    });
  });

  afterAll(async () => {
    const users = [ids.t1, ids.t2, ids.hi, ids.med, ids.lo].filter(Boolean);
    await prisma.emailOutbox.deleteMany({ where: { toEmail: { endsWith: `@${MARK}.test` } } });
    await prisma.notification.deleteMany({ where: { userId: { in: users } } });
    await prisma.course.deleteMany({ where: { code: { startsWith: MARK } } });
    await prisma.section.deleteMany({ where: { name: MARK } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.subject.deleteMany({ where: { code: MARK.toUpperCase() } });
  });

  it('force computes levels; a second unforced run within the hour is skipped as fresh (FR-27)', async () => {
    const first = await force();
    expect(first.skipped).toBeNull();
    expect(first.studentsComputed).toBeGreaterThanOrEqual(3);
    expect((await snap(ids.hi)).level).toBe('HIGH');
    expect((await snap(ids.med)).level).toBe('MEDIUM');
    expect((await snap(ids.lo)).level).toBeNull();
    expect((await snap(ids.hi)).signals).toMatchObject({ missingCount: 5 });

    expect(await recomputeRiskSnapshots()).toEqual({ skipped: 'fresh', studentsComputed: 0 });
    await prisma.studentRiskSnapshot.updateMany({ where: { termId: ids.term }, data: { computedAt: new Date(Date.now() - 61 * 60_000) } });
    expect((await recomputeRiskSnapshots()).skipped).toBeNull();
  });

  it('sort is HIGH first, then reasons, then name; trend comes from previousLevel (FR-28, FR-29)', async () => {
    const { rows } = await listAtRisk(T1(), {});
    expect(rows.map((r) => r.studentId)).toEqual([ids.hi, ids.med]);
    expect(rows[0]).toMatchObject({ level: 'HIGH', trend: 'up', sectionName: MARK, reasons: [{ signal: 'MISSING', label: '5 missing' }] });

    await setHi('MEDIUM');
    const after = await listAtRisk(T1(), { level: 'MEDIUM' });
    const hi = after.rows.find((r) => r.studentId === ids.hi)!;
    expect(hi.trend).toBe('down');
    expect(after.rows.every((r) => r.level === 'MEDIUM')).toBe(true);
    await setHi('HIGH');
  });

  it('a teacher filtering by an out-of-scope section gets 0 rows, never wider (FR-42, NFR-3)', async () => {
    expect((await listAtRisk(T2(), { sectionId: ids.section })).rows).toEqual([]);
    expect((await listAtRisk(T2(), {})).rows).toEqual([]);
    expect((await listAtRisk(T1(), { sectionId: ids.section })).total).toBe(2);
    const admin = await listAtRisk(ADMIN, { sectionId: ids.section }, { page: 1, pageSize: 1 });
    expect(admin).toMatchObject({ total: 2 });
    expect(admin.rows).toHaveLength(1);
  });

  it('history appends only on a level change and is capped at 10 (FR-28)', async () => {
    const before = (await snap(ids.hi)).history as unknown[];
    await force(); // unchanged level
    expect((await snap(ids.hi)).history).toEqual(before);

    const fake = Array.from({ length: 10 }, (_, i) => ({ level: 'MEDIUM', reasons: [], computedAt: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z` }));
    await prisma.studentRiskSnapshot.update({ where: { studentId_termId: { studentId: ids.hi, termId: ids.term } }, data: { history: fake } });
    await setHi('MEDIUM');
    const history = (await snap(ids.hi)).history as { level: string; computedAt: string }[];
    expect(history).toHaveLength(10);
    expect(history[0].level).toBe('MEDIUM');
    expect(history[0].computedAt > '2026-02-01').toBe(true);
    expect(history[9]).toEqual(fake[8]);
    await setHi('HIGH');
  });

  it('the HIGH notification is claimed once per 14 days (FR-32)', async () => {
    expect(await notes()).toBe(1); // from the first HIGH
    await setHi('MEDIUM');
    await setHi('HIGH');
    expect(await notes()).toBe(1);

    await prisma.studentRiskSnapshot.update({
      where: { studentId_termId: { studentId: ids.hi, termId: ids.term } },
      data: { highNotifiedAt: new Date(Date.now() - 15 * DAY) },
    });
    await setHi('MEDIUM');
    await Promise.all([setHi('HIGH'), recomputeRiskSnapshots({ force: true })]);
    expect(await notes()).toBe(2);
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: ids.t1, type: 'insights.student_high_risk' } });
    expect(n.link).toBe(`/students/${ids.hi}/insights`);
  });

  it('getStudentInsights: 404 unknown, 403 out of scope, history newest first (FR-43)', async () => {
    await expect(getStudentInsights(ADMIN, 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(getStudentInsights(T2(), ids.hi)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const res = await getStudentInsights(T1(), ids.hi);
    expect(res).toMatchObject({ studentId: ids.hi, termId: ids.term, level: 'HIGH', signals: { missingCount: 5 } });
    expect(res.history.length).toBeGreaterThan(0);
    expect(res.history[0].level).toBe('HIGH');
  });
});
