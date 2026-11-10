import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import type { EnrollmentFilters } from '@/lib/validators/reports';
import type { ReportContext, ReportOutput } from './index';

/** PRD-16 FR-34: active students by grade level × section × gender; enrollments and archives by month. */

const GENDER = { FEMALE: 'Female', MALE: 'Male', OTHER: 'Other', UNDISCLOSED: 'Not stated' } as Record<string, string>;
const when = (cond: unknown, frag: Prisma.Sql) => (cond ? frag : Prisma.empty);

async function run(f: EnrollmentFilters, ctx: ReportContext): Promise<ReportOutput> {
  const groups = await prisma.$queryRaw<{ gradeLevel: string; gradeOrder: number; section: string | null; gender: string; n: number }[]>`
    SELECT gl.name AS "gradeLevel", gl."order" AS "gradeOrder", s.name AS section, sp.gender::text AS gender, COUNT(*)::int AS n
    FROM "User" u
    JOIN "StudentProfile" sp ON sp."userId" = u.id
    JOIN "GradeLevel" gl ON gl.id = sp."gradeLevelId"
    LEFT JOIN "SectionMember" sm ON sm."studentId" = u.id AND sm."academicYearId" = ${ctx.year.id}
    LEFT JOIN "Section" s ON s.id = sm."sectionId"
    WHERE u.role = 'STUDENT' AND u.status = 'ACTIVE' AND u."archivedAt" IS NULL
      ${when(f.gradeLevel, Prisma.sql`AND gl.id = ${f.gradeLevel}`)}
      ${when(f.sectionId, Prisma.sql`AND s.id = ${f.sectionId}`)}
    GROUP BY gl.name, gl."order", s.name, sp.gender
    ORDER BY gl."order", s.name NULLS LAST, sp.gender`;

  const rows = groups.map((g) => ({ gradeLevel: g.gradeLevel, section: g.section ?? 'Unassigned', gender: GENDER[g.gender] ?? g.gender, activeStudents: g.n }));

  // Months in the school timezone (NFR-7). enrollmentDate is a date; archivedAt an instant.
  const [joined, archived] = await Promise.all([
    prisma.$queryRaw<{ month: string; n: number }[]>`
      SELECT to_char(date_trunc('month', sp."enrollmentDate"), 'YYYY-MM') AS month, COUNT(*)::int AS n
      FROM "StudentProfile" sp
      WHERE sp."enrollmentDate" >= ${ctx.from}::date AND sp."enrollmentDate" <= ${ctx.to}::date
        ${when(f.gradeLevel, Prisma.sql`AND sp."gradeLevelId" = ${f.gradeLevel}`)}
      GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ month: string; n: number }[]>`
      SELECT to_char(date_trunc('month', (u."archivedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${ctx.tz}), 'YYYY-MM') AS month, COUNT(*)::int AS n
      FROM "User" u JOIN "StudentProfile" sp ON sp."userId" = u.id
      WHERE u.role = 'STUDENT' AND u."archivedAt" IS NOT NULL
        AND ((u."archivedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${ctx.tz})::date BETWEEN ${ctx.from}::date AND ${ctx.to}::date
        ${when(f.gradeLevel, Prisma.sql`AND sp."gradeLevelId" = ${f.gradeLevel}`)}
      GROUP BY 1 ORDER BY 1`,
  ]);

  const levels = [...new Map(groups.map((g) => [g.gradeLevel, g.gradeOrder])).entries()].sort((a, b) => a[1] - b[1]).map(([n]) => n);
  const genders = [...new Set(groups.map((g) => g.gender))];
  const total = rows.reduce((s, r) => s + r.activeStudents, 0);
  const months = [...new Set([...joined, ...archived].map((m) => m.month))].sort();
  const at = (list: { month: string; n: number }[], m: string) => list.find((x) => x.month === m)?.n ?? 0;

  return {
    rows,
    charts: [
      {
        kind: 'bar',
        summary: `Active students by grade level: ${levels.map((l) => `${l} ${groups.filter((g) => g.gradeLevel === l).reduce((s, g) => s + g.n, 0)}`).join(', ') || 'none'}`,
        xAxis: levels,
        series: genders.map((g) => ({
          id: g,
          label: GENDER[g] ?? g,
          data: levels.map((l) => groups.filter((x) => x.gradeLevel === l && x.gender === g).reduce((s, x) => s + x.n, 0)),
          stack: 'gender',
        })),
      },
      {
        kind: 'bar',
        summary: `New enrollments and archives by month, ${ctx.from} to ${ctx.to}: ${joined.reduce((s, m) => s + m.n, 0)} new, ${archived.reduce((s, m) => s + m.n, 0)} archived`,
        xAxis: months,
        series: [
          { id: 'new', label: 'New enrollments', data: months.map((m) => at(joined, m)) },
          { id: 'archived', label: 'Archived', data: months.map((m) => at(archived, m)) },
        ],
      },
    ],
    summary: {
      activeStudents: total,
      newEnrollments: joined.reduce((s, m) => s + m.n, 0),
      archived: archived.reduce((s, m) => s + m.n, 0),
    },
  };
}

export const report = {
  title: 'Enrollment',
  description: 'Active students by grade, section and gender; new enrollments and archives by month.',
  columns: [
    { key: 'gradeLevel', header: 'Grade level' },
    { key: 'section', header: 'Section' },
    { key: 'gender', header: 'Gender' },
    { key: 'activeStudents', header: 'Active students' },
  ],
  run,
};
