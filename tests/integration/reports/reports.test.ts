// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DATABASE_URL ??= 'postgresql://unused@localhost/unused';
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.AUTH_SECRET ??= 'test-secret';
});

import { parse } from 'papaparse';
import { prisma } from '@/server/db';
import { toCsv } from '@/server/csv';
import { REPORT_KEYS, REPORTS, runReport } from '@/server/reports';

/**
 * PRD-16 FR-33–FR-39, FR-44 on the seeded DB plus a small tagged fixture with known numbers:
 * one teacher, one course, 2 students, 3 assignments in the last week (1 on time, 1 late, rest missing).
 */
const MARK = 'qa-sh16-rep';
const DAY = 86_400_000;
const ids = {} as Record<'teacher' | 's1' | 's2' | 'subject' | 'course' | 'year', string>;

describe.skipIf(!process.env.TEST_DATABASE_URL)('reports registry (integration)', () => {
  beforeAll(async () => {
    const year = await prisma.academicYear.findFirstOrThrow({ where: { isCurrent: true } });
    ids.year = year.id;
    const gradeLevel = await prisma.gradeLevel.findFirstOrThrow();
    const mk = (n: string, role: 'TEACHER' | 'STUDENT') =>
      prisma.user.create({ data: { email: `${n}@${MARK}.test`, firstName: n, lastName: MARK, role, status: 'ACTIVE' } }).then((u) => u.id);
    Object.assign(ids, { teacher: await mk('teacher', 'TEACHER'), s1: await mk('s1', 'STUDENT'), s2: await mk('s2', 'STUDENT') });
    for (const [i, id] of [ids.s1, ids.s2].entries()) {
      await prisma.studentProfile.create({
        data: { userId: id, admissionNumber: `${MARK}-${i}`, dateOfBirth: new Date('2014-01-01'), gradeLevelId: gradeLevel.id, enrollmentDate: new Date() },
      });
    }
    ids.subject = (await prisma.subject.create({ data: { name: MARK, code: MARK.toUpperCase() } })).id;
    ids.course = (await prisma.course.create({ data: { name: MARK, code: MARK, academicYearId: year.id, subjectId: ids.subject, teacherId: ids.teacher } })).id;
    await prisma.enrollment.createMany({ data: [ids.s1, ids.s2].map((studentId) => ({ courseId: ids.course, studentId })) });
    const due = (d: number) => new Date(Date.now() - d * DAY);
    const assignments = [];
    for (const d of [2, 3, 4]) {
      assignments.push(
        await prisma.assignment.create({
          data: { courseId: ids.course, title: `${MARK} ${d}`, submissionType: 'ONLINE_TEXT', maxPoints: '10', dueAt: due(d), status: 'PUBLISHED', createdById: ids.teacher },
        }),
      );
    }
    // s1: on time for #1, late for #2 (ungraded → backlog 2); everything else missing → 4 missing.
    await prisma.submission.createMany({
      data: [
        { assignmentId: assignments[0].id, studentId: ids.s1, attemptNumber: 1, submittedAt: due(3) },
        { assignmentId: assignments[1].id, studentId: ids.s1, attemptNumber: 1, submittedAt: due(1) },
      ],
    });
  });

  afterAll(async () => {
    await prisma.course.deleteMany({ where: { code: MARK } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `@${MARK}.test` } } });
    await prisma.subject.deleteMany({ where: { code: MARK.toUpperCase() } });
  });

  it('registers exactly the six report keys', () => {
    expect(Object.keys(REPORTS).sort()).toEqual([...REPORT_KEYS].sort());
  });

  it('unknown key → NOT_FOUND; bad filters → ZodError (400)', async () => {
    await expect(runReport('nope', {})).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(runReport('attendance', { from: '2026-11-10', to: '2026-11-01' })).rejects.toHaveProperty('name', 'ZodError');
    await expect(runReport('attendance', { groupBy: 'planet' })).rejects.toHaveProperty('name', 'ZodError');
  });

  it.each(REPORT_KEYS)('%s runs on the seed and its CSV rows equal its table rows (FR-35 AC 7)', async (key) => {
    const result = await runReport(key, {});
    expect(result).toMatchObject({ key, title: expect.any(String), columns: expect.any(Array), charts: expect.any(Array) });
    for (const chart of result.charts) expect(chart.summary.length).toBeGreaterThan(0);
    const csv = parse<string[]>(toCsv(result.columns, result.rows), { skipEmptyLines: true }).data;
    expect(csv[0]).toEqual(result.columns.map((c) => c.header));
    expect(csv.slice(1)).toEqual(result.rows.map((r) => result.columns.map((c) => (r[c.key] == null ? '' : String(r[c.key])))));
  });

  it('enrollment: active students equals the database count', async () => {
    const { summary } = await runReport('enrollment', {});
    expect(summary.activeStudents).toBe(await prisma.user.count({ where: { role: 'STUDENT', status: 'ACTIVE', archivedAt: null, studentProfile: { isNot: null } } }));
  });

  it('completion: fixture course has 1 on time, 1 late, 4 missing (FR-37)', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 10 * DAY).toISOString().slice(0, 10);
    const { rows } = await runReport('completion', { from, to: today });
    expect(rows.find((r) => r.group === MARK)).toMatchObject({ expected: 6, onTime: 1, late: 1, missing: 4, onTimeRate: 16.7, missingRate: 66.7 });
    const byTeacher = await runReport('completion', { from, to: today, groupBy: 'teacher' });
    expect(byTeacher.rows.find((r) => r.group === `teacher ${MARK}`)).toMatchObject({ expected: 6 });
  });

  it('workload: fixture teacher has 1 course, 2 students, backlog 2 (FR-39)', async () => {
    const { rows } = await runReport('workload', {});
    expect(rows.find((r) => r.teacherName === `teacher ${MARK}`)).toEqual({
      teacherName: `teacher ${MARK}`,
      courses: 1,
      studentsTaught: 2,
      weeklyPeriods: 0,
      gradingBacklog: 2,
    });
  });

  it('engagement notes the missing announcement read rate (FR-38)', async () => {
    const r = await runReport('engagement', {});
    expect(r.notes.join(' ')).toMatch(/read rate is not available/);
    expect(r.summary).toMatchObject({ totalParents: expect.any(Number), parentsSignedIn7d: expect.any(Number) });
  });
});
