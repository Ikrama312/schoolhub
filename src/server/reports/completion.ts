import { prisma } from '@/server/db';
import { visibleWhere } from '@/server/assignments/assignments-service';
import { schoolMidnight, addDateDays } from '@/lib/dates';
import { missingWork } from '@/server/dashboards/missing-work';
import type { CompletionFilters } from '@/lib/validators/reports';
import type { ReportContext, ReportOutput } from './index';

/**
 * PRD-16 FR-37: on-time / late / missing rates by course or teacher for assignments due in the
 * range. Missing uses the shared predicate; expected = on time + late + missing.
 */

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);

async function run(f: CompletionFilters, ctx: ReportContext): Promise<ReportOutput> {
  const now = new Date();
  const from = schoolMidnight(ctx.from, ctx.tz);
  const to = schoolMidnight(addDateDays(ctx.to, 1), ctx.tz);
  const [assignments, missing] = await Promise.all([
    prisma.assignment.findMany({
      where: { AND: [visibleWhere(now), { dueAt: { gte: from, lt: to }, submissionType: { not: 'NO_SUBMISSION' }, course: { academicYearId: ctx.year.id } }] },
      select: {
        id: true,
        dueAt: true,
        course: { select: { name: true, teacher: { select: { firstName: true, lastName: true } } } },
        submissions: { where: { attemptNumber: { gt: 0 } }, select: { submittedAt: true } },
      },
    }),
    missingWork({ from, to, now }),
  ]);

  const missingByAssignment = new Map<string, number>();
  for (const items of missing.values()) for (const i of items) missingByAssignment.set(i.assignmentId, (missingByAssignment.get(i.assignmentId) ?? 0) + 1);

  const groups = new Map<string, { onTime: number; late: number; missing: number }>();
  for (const a of assignments) {
    const key = f.groupBy === 'teacher' ? `${a.course.teacher.firstName} ${a.course.teacher.lastName}` : a.course.name;
    const g = groups.get(key) ?? { onTime: 0, late: 0, missing: 0 };
    for (const s of a.submissions) s.submittedAt <= a.dueAt ? g.onTime++ : g.late++;
    g.missing += missingByAssignment.get(a.id) ?? 0;
    groups.set(key, g);
  }

  const rows = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, g]) => {
      const expected = g.onTime + g.late + g.missing;
      return { group, expected, ...g, onTimeRate: pct(g.onTime, expected), lateRate: pct(g.late, expected), missingRate: pct(g.missing, expected) };
    });
  const totals = rows.reduce((t, r) => ({ expected: t.expected + r.expected, onTime: t.onTime + r.onTime, late: t.late + r.late, missing: t.missing + r.missing }), { expected: 0, onTime: 0, late: 0, missing: 0 });

  return {
    rows,
    charts: [
      {
        kind: 'bar',
        summary: totals.expected
          ? `Completion ${ctx.from} to ${ctx.to}: ${pct(totals.onTime, totals.expected)} % on time, ${pct(totals.late, totals.expected)} % late, ${pct(totals.missing, totals.expected)} % missing`
          : `No assignments due ${ctx.from} to ${ctx.to}`,
        xAxis: rows.map((r) => r.group),
        series: [
          { id: 'onTime', label: 'On time', data: rows.map((r) => r.onTime), stack: 'c' },
          { id: 'late', label: 'Late', data: rows.map((r) => r.late), stack: 'c' },
          { id: 'missing', label: 'Missing', data: rows.map((r) => r.missing), stack: 'c' },
        ],
      },
    ],
    summary: { assignments: assignments.length, ...totals, onTimeRate: pct(totals.onTime, totals.expected), missingRate: pct(totals.missing, totals.expected) },
  };
}

export const report = {
  title: 'Assignment completion',
  description: 'On-time, late and missing submission rates by course or teacher.',
  columns: [
    { key: 'group', header: 'Group' },
    { key: 'expected', header: 'Expected' },
    { key: 'onTime', header: 'On time' },
    { key: 'late', header: 'Late' },
    { key: 'missing', header: 'Missing' },
    { key: 'onTimeRate', header: 'On time %' },
    { key: 'lateRate', header: 'Late %' },
    { key: 'missingRate', header: 'Missing %' },
  ],
  run,
};
