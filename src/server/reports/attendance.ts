import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { getReport } from '@/server/attendance/attendance-service';
import { attendanceRate } from '@/server/attendance/attendance-rules';
import type { AttendanceFilters } from '@/lib/validators/reports';
import type { ReportContext, ReportOutput } from './index';

/**
 * PRD-16 FR-35: attendance rolled up by grade level, section or course, a daily trend and the
 * 20 lowest students. Per-student numbers come from attendance-service.getReport (NFR-8).
 */

type Counts = { present: number; absent: number; late: number; excused: number };
const zero = (): Counts => ({ present: 0, absent: 0, late: 0, excused: 0 });
const when = (cond: unknown, frag: Prisma.Sql) => (cond ? frag : Prisma.empty);

function row(group: string, c: Counts) {
  return { group, ...c, total: c.present + c.absent + c.late + c.excused, rate: attendanceRate(c) };
}

async function run(f: AttendanceFilters, ctx: ReportContext): Promise<ReportOutput> {
  const settings = await prisma.schoolSettings.findUnique({ where: { id: 'singleton' }, select: { attendanceMode: true, attendanceAlertThreshold: true } });
  const kind = settings?.attendanceMode === 'DAILY_HOMEROOM' ? Prisma.sql`s."sectionId" IS NOT NULL` : Prisma.sql`s."courseId" IS NOT NULL`;
  const studentFilter = Prisma.sql`
    ${when(f.gradeLevel, Prisma.sql`AND r."studentId" IN (SELECT "userId" FROM "StudentProfile" WHERE "gradeLevelId" = ${f.gradeLevel})`)}
    ${when(f.sectionId, Prisma.sql`AND r."studentId" IN (SELECT "studentId" FROM "SectionMember" WHERE "sectionId" = ${f.sectionId})`)}`;

  const [students, daily] = await Promise.all([
    getReport({ from: ctx.from, to: ctx.to, gradeLevelId: f.gradeLevel, sectionId: f.sectionId }),
    prisma.$queryRaw<{ date: Date; status: string; n: number }[]>`
      SELECT s."date" AS date, r.status::text AS status, COUNT(*)::int AS n
      FROM "AttendanceRecord" r JOIN "AttendanceSession" s ON s.id = r."sessionId"
      WHERE s."date" BETWEEN ${ctx.from}::date AND ${ctx.to}::date AND ${kind} ${studentFilter}
      GROUP BY s."date", r.status ORDER BY s."date"`,
  ]);

  let rows: ReturnType<typeof row>[];
  if (f.groupBy === 'course') {
    const byCourse = await prisma.$queryRaw<{ course: string; status: string; n: number }[]>`
      SELECT c.name AS course, r.status::text AS status, COUNT(*)::int AS n
      FROM "AttendanceRecord" r JOIN "AttendanceSession" s ON s.id = r."sessionId" JOIN "Course" c ON c.id = s."courseId"
      WHERE s."date" BETWEEN ${ctx.from}::date AND ${ctx.to}::date ${studentFilter}
      GROUP BY c.name, r.status ORDER BY c.name`;
    const m = new Map<string, Counts>();
    for (const g of byCourse) {
      const c = m.get(g.course) ?? zero();
      c[g.status.toLowerCase() as keyof Counts] += g.n;
      m.set(g.course, c);
    }
    rows = [...m.entries()].map(([k, c]) => row(k, c));
  } else {
    const m = new Map<string, Counts>();
    for (const s of students) {
      const key = (f.groupBy === 'section' ? s.sectionName : s.gradeLevelName) ?? 'Unassigned';
      const c = m.get(key) ?? zero();
      c.present += s.present;
      c.absent += s.absent;
      c.late += s.late;
      c.excused += s.excused;
      m.set(key, c);
    }
    rows = [...m.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([k, c]) => row(k, c));
  }

  const days = new Map<string, Counts>();
  for (const d of daily) {
    const key = d.date.toISOString().slice(0, 10);
    const c = days.get(key) ?? zero();
    c[d.status.toLowerCase() as keyof Counts] += d.n;
    days.set(key, c);
  }
  const trendX = [...days.keys()];
  const trend = trendX.map((d) => attendanceRate(days.get(d)!));
  const overall = rows.reduce((acc, r) => ({ present: acc.present + r.present, absent: acc.absent + r.absent, late: acc.late + r.late, excused: acc.excused + r.excused }), zero());
  const overallRate = attendanceRate(overall);

  const lowestStudents = students
    .filter((s) => s.rate !== null)
    .sort((a, b) => a.rate! - b.rate! || a.studentName.localeCompare(b.studentName))
    .slice(0, 20)
    .map((s) => ({ studentId: s.studentId, studentName: s.studentName, sectionName: s.sectionName, rate: s.rate, absent: s.absent, late: s.late }));

  return {
    rows,
    charts: [
      {
        kind: 'line',
        summary: overallRate === null ? 'Daily attendance: no records in this range' : `Daily attendance ${ctx.from} to ${ctx.to}: ${overallRate} % overall across ${trendX.length} school days`,
        xAxis: trendX,
        series: [{ id: 'rate', label: 'Attendance %', data: trend }],
        referenceLine: settings?.attendanceAlertThreshold ?? 90,
      },
    ],
    summary: { overallRate, records: overall.present + overall.absent + overall.late + overall.excused, schoolDays: trendX.length, lowestStudents },
  };
}

export const report = {
  title: 'Attendance',
  description: 'Attendance by grade level, section or course, the daily trend and the lowest 20 students.',
  columns: [
    { key: 'group', header: 'Group' },
    { key: 'present', header: 'Present' },
    { key: 'absent', header: 'Absent' },
    { key: 'late', header: 'Late' },
    { key: 'excused', header: 'Excused' },
    { key: 'total', header: 'Total' },
    { key: 'rate', header: 'Rate %' },
  ],
  run,
};
