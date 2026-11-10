import { prisma } from '@/server/db';
import { loadTermPercents } from '@/server/gradebook/batch-grades';
import type { PerformanceFilters } from '@/lib/validators/reports';
import type { ReportContext, ReportOutput } from './index';

/**
 * PRD-16 FR-36: average term percent and letter distribution by course or subject, plus a
 * section comparison for the same grade × subject. Same calc as the Grades tab (batch loader).
 */

const LETTERS = ['A', 'B', 'C', 'D', 'F'] as const;
const round1 = (n: number) => Math.round(n * 10) / 10;
const avg = (xs: number[]) => (xs.length ? round1(xs.reduce((s, x) => s + x, 0) / xs.length) : null);

async function run(f: PerformanceFilters, ctx: ReportContext): Promise<ReportOutput> {
  if (!ctx.term) return { rows: [], charts: [], summary: { sectionComparison: [] }, notes: ['This academic year has no terms.'] };
  const [percents, courses] = await Promise.all([
    loadTermPercents(ctx.term.id),
    prisma.course.findMany({
      where: {
        academicYearId: ctx.year.id,
        ...(f.subjectId ? { subjectId: f.subjectId } : {}),
        ...(f.gradeLevel ? { section: { gradeLevelId: f.gradeLevel } } : {}),
      },
      select: {
        id: true,
        name: true,
        subject: { select: { id: true, name: true } },
        section: { select: { name: true, gradeLevel: { select: { id: true, name: true } } } },
      },
    }),
  ]);
  const byId = new Map(courses.map((c) => [c.id, c]));
  const entries = [...percents.entries()].flatMap(([studentId, list]) =>
    list.filter((p) => p.percent !== null && byId.has(p.courseId)).map((p) => ({ studentId, ...p, course: byId.get(p.courseId)! })),
  );

  const groups = new Map<string, typeof entries>();
  for (const e of entries) {
    const key = f.groupBy === 'subject' ? e.course.subject.name : e.course.name;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const rows = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, list]) => {
      const letters = Object.fromEntries(LETTERS.map((l) => [l, list.filter((e) => e.letter?.[0]?.toUpperCase() === l).length]));
      return { group, students: new Set(list.map((e) => e.studentId)).size, averagePct: avg(list.map((e) => e.percent!)), ...letters };
    });

  // Same grade level × subject, more than one section → compare section averages.
  const cohorts = new Map<string, typeof entries>();
  for (const e of entries) {
    if (!e.course.section) continue;
    const key = `${e.course.section.gradeLevel.name}|${e.course.subject.name}`;
    cohorts.set(key, [...(cohorts.get(key) ?? []), e]);
  }
  const sectionComparison = [...cohorts.entries()]
    .map(([key, list]) => {
      const [gradeLevel, subject] = key.split('|');
      const bySection = new Map<string, number[]>();
      for (const e of list) bySection.set(e.course.section!.name, [...(bySection.get(e.course.section!.name) ?? []), e.percent!]);
      return {
        gradeLevel,
        subject,
        sections: [...bySection.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([section, ps]) => ({ section, students: ps.length, averagePct: avg(ps) })),
      };
    })
    .filter((c) => c.sections.length > 1);

  const overall = avg(entries.map((e) => e.percent!));
  return {
    rows,
    charts: [
      {
        kind: 'bar',
        summary: rows.length
          ? `Average term percent by ${f.groupBy}, ${ctx.term.name}: overall ${overall} %. ${rows.map((r) => `${r.group} ${r.averagePct} %`).join(', ')}`
          : `No grades in ${ctx.term.name} yet`,
        xAxis: rows.map((r) => r.group),
        series: [{ id: 'avg', label: 'Average %', data: rows.map((r) => r.averagePct) }],
      },
      {
        kind: 'bar',
        summary: `Letter distribution by ${f.groupBy}`,
        xAxis: rows.map((r) => r.group),
        series: LETTERS.map((l) => ({ id: l, label: l, data: rows.map((r) => (r as unknown as Record<string, number>)[l]), stack: 'letters' })),
      },
    ],
    summary: { term: ctx.term.name, averagePct: overall, gradedEntries: entries.length, sectionComparison },
  };
}

export const report = {
  title: 'Academic performance',
  description: 'Average term percent and letter distribution by course or subject, with section comparison.',
  columns: [
    { key: 'group', header: 'Group' },
    { key: 'students', header: 'Students' },
    { key: 'averagePct', header: 'Average %' },
    ...LETTERS.map((l) => ({ key: l, header: l })),
  ],
  run,
};
