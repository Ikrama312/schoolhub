import { prisma } from '@/server/db';
import type { WorkloadFilters } from '@/lib/validators/reports';
import type { ReportContext, ReportOutput } from './index';

/** PRD-16 FR-39: per teacher — courses, distinct students, weekly periods and grading backlog. */

async function run(_f: WorkloadFilters, ctx: ReportContext): Promise<ReportOutput> {
  const [teachers, submissions, attempts] = await Promise.all([
    prisma.user.findMany({
      where: { role: 'TEACHER', status: 'ACTIVE', archivedAt: null },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    }),
    // Same "to grade" predicate as the teacher dashboard (FR-5), grouped by course.
    prisma.submission.groupBy({
      by: ['assignmentId'],
      where: { status: 'SUBMITTED', gradedAt: null, attemptNumber: { gt: 0 }, assignment: { archivedAt: null, course: { academicYearId: ctx.year.id } } },
      _count: { _all: true },
    }),
    prisma.quizAttempt.groupBy({ by: ['quizId'], where: { status: 'NEEDS_GRADING', quiz: { course: { academicYearId: ctx.year.id } } }, _count: { _all: true } }),
  ]);
  const courses = await prisma.course.findMany({
    where: { academicYearId: ctx.year.id, archivedAt: null },
    select: {
      id: true,
      teacherId: true,
      coTeacherIds: true,
      enrollments: { where: { status: 'ACTIVE' }, select: { studentId: true } },
      _count: { select: { timetableSlots: true } },
      assignments: { select: { id: true } },
      quizzes: { select: { id: true } },
    },
  });
  const subCount = new Map(submissions.map((s) => [s.assignmentId, s._count._all]));
  const attCount = new Map(attempts.map((a) => [a.quizId, a._count._all]));

  const rows = teachers.map((t) => {
    const mine = courses.filter((c) => c.teacherId === t.id || c.coTeacherIds.includes(t.id));
    const backlog = mine.reduce(
      (s, c) => s + c.assignments.reduce((x, a) => x + (subCount.get(a.id) ?? 0), 0) + c.quizzes.reduce((x, q) => x + (attCount.get(q.id) ?? 0), 0),
      0,
    );
    return {
      teacherName: `${t.firstName} ${t.lastName}`,
      courses: mine.length,
      studentsTaught: new Set(mine.flatMap((c) => c.enrollments.map((e) => e.studentId))).size,
      weeklyPeriods: mine.reduce((s, c) => s + c._count.timetableSlots, 0),
      gradingBacklog: backlog,
    };
  });

  return {
    rows,
    charts: [
      {
        kind: 'bar',
        summary: rows.length
          ? `Teacher workload: ${rows.map((r) => `${r.teacherName} ${r.weeklyPeriods} periods, ${r.gradingBacklog} to grade`).join('; ')}`
          : 'No active teachers',
        xAxis: rows.map((r) => r.teacherName),
        series: [
          { id: 'periods', label: 'Weekly periods', data: rows.map((r) => r.weeklyPeriods) },
          { id: 'backlog', label: 'Grading backlog', data: rows.map((r) => r.gradingBacklog) },
        ],
      },
    ],
    summary: { teachers: rows.length, totalBacklog: rows.reduce((s, r) => s + r.gradingBacklog, 0) },
  };
}

export const report = {
  title: 'Teacher workload',
  description: 'Courses, students, weekly periods and grading backlog per teacher.',
  columns: [
    { key: 'teacherName', header: 'Teacher' },
    { key: 'courses', header: 'Courses' },
    { key: 'studentsTaught', header: 'Students taught' },
    { key: 'weeklyPeriods', header: 'Weekly periods' },
    { key: 'gradingBacklog', header: 'Grading backlog' },
  ],
  run,
};
