import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import type { AccessUser } from '@/server/auth/student-access';
import { getOverview } from '@/server/attendance/attendance-service';
import { attendanceRate } from '@/server/attendance/attendance-rules';
import { getSchoolTimezone } from '@/server/assignments/assignments-service';
import { isSafeguardingLead } from '@/server/messaging/access';
import { expandOccurrences } from '@/server/calendar/recurrence';
import { loadTermPercents } from '@/server/gradebook/batch-grades';
import { addDateDays, formatInSchoolTz, schoolDateOf, schoolDaysBack } from '@/lib/dates';
import { cached, currentTerm, TAGS } from './insights';

/** PRD-16 admin dashboard (FR-16–FR-22). Shared aggregates cached 15 min under dashboard:admin. */

const ADMIN_CACHE = { revalidate: 900, tags: [TAGS.admin] };
const DAY = 86_400_000;

export interface ChartSeries {
  summary: string;
  xAxis: (string | number)[];
  series: { id: string; label: string; data: (number | null)[]; stack?: string }[];
  referenceLine?: number;
}

async function settings() {
  const s = await prisma.schoolSettings.findUnique({ where: { id: 'singleton' } });
  return { tz: s?.timezone ?? 'UTC', mode: s?.attendanceMode ?? 'PER_PERIOD', threshold: s?.attendanceAlertThreshold ?? 90 };
}

const today = async () => schoolDateOf(new Date(), await getSchoolTimezone());

/** FR-16: headline counts. The safeguarding count is NOT here (see getSafeguardingCount). */
export async function getKpis() {
  const day = await today();
  return cached(
    async () => {
      const [activeStudents, activeTeachers, now, weekAgo, pendingAbsenceNotes] = await Promise.all([
        prisma.user.count({ where: { role: 'STUDENT', status: 'ACTIVE', archivedAt: null } }),
        prisma.user.count({ where: { role: 'TEACHER', status: 'ACTIVE', archivedAt: null } }),
        getOverview(day),
        getOverview(addDateDays(day, -7)),
        prisma.absenceNote.count({ where: { status: 'PENDING' } }),
      ]);
      return {
        activeStudents,
        activeTeachers,
        attendanceRateToday: now.rate,
        attendanceRateDelta: now.rate !== null && weekAgo.rate !== null ? Math.round((now.rate - weekAgo.rate) * 10) / 10 : null,
        registersMissingToday: now.missing.length,
        pendingAbsenceNotes,
      };
    },
    ['dash', 'admin', 'kpis', day],
    ADMIN_CACHE,
  );
}

/** FR-16: never cached, so the count never sits in a shared cache entry. null for non-leads. */
export async function getSafeguardingCount(user: AccessUser): Promise<number | null> {
  if (!(await isSafeguardingLead(user))) return null;
  return prisma.messageReport.count({ where: { status: 'OPEN' } });
}

/** FR-17: daily attendance rate over the last 30 school days, with the alert threshold. */
export async function getAttendanceTrend() {
  const day = await today();
  return cached(
    async (): Promise<ChartSeries> => {
      const { tz, mode, threshold } = await settings();
      const sessionDates = await prisma.attendanceSession.findMany({
        where: { date: { lte: new Date(`${day}T00:00:00Z`) } },
        distinct: ['date'],
        select: { date: true },
        orderBy: { date: 'desc' },
        take: 30,
      });
      const days = schoolDaysBack(30, tz, sessionDates.map((s) => s.date.toISOString().slice(0, 10)));
      const kind = mode === 'DAILY_HOMEROOM' ? Prisma.sql`s."sectionId" IS NOT NULL` : Prisma.sql`s."courseId" IS NOT NULL`;
      const rows = days.length
        ? await prisma.$queryRaw<{ date: Date; status: string; n: number }[]>`
            SELECT s."date" AS date, r."status"::text AS status, COUNT(*)::int AS n
            FROM "AttendanceRecord" r JOIN "AttendanceSession" s ON s.id = r."sessionId"
            WHERE s."date" >= ${new Date(`${days[0]}T00:00:00Z`)}::date AND s."date" <= ${new Date(`${day}T00:00:00Z`)}::date AND ${kind}
            GROUP BY s."date", r."status"`
        : [];
      const byDay = new Map(days.map((d) => [d, { present: 0, absent: 0, late: 0, excused: 0 }]));
      for (const r of rows) {
        const c = byDay.get(r.date.toISOString().slice(0, 10));
        if (c) c[r.status.toLowerCase() as keyof typeof c] += r.n;
      }
      const data = days.map((d) => attendanceRate(byDay.get(d)!));
      const known = data.map((v, i) => ({ v, d: days[i] })).filter((x): x is { v: number; d: string } => x.v !== null);
      const avg = known.length ? Math.round((known.reduce((s, x) => s + x.v, 0) / known.length) * 10) / 10 : null;
      const low = known.reduce<{ v: number; d: string } | null>((m, x) => (!m || x.v < m.v ? x : m), null);
      const label = (d: string) => formatInSchoolTz(new Date(`${d}T12:00:00Z`), 'd MMM', 'UTC');
      return {
        summary: avg === null ? 'Attendance trend: no attendance recorded yet' : `Attendance trend: ${avg} % average, lowest ${low!.v} % on ${label(low!.d)}`,
        xAxis: days.map(label),
        series: [{ id: 'rate', label: 'Attendance %', data }],
        referenceLine: threshold,
      };
    },
    ['dash', 'admin', 'trend', day],
    ADMIN_CACHE,
  );
}

const GENDER_LABELS: Record<string, string> = { FEMALE: 'Female', MALE: 'Male', OTHER: 'Other', UNDISCLOSED: 'Not stated' };

/** FR-18: active students by grade level, stacked by gender. */
export function getEnrollmentByGrade() {
  return cached(
    async (): Promise<ChartSeries> => {
      const [groups, levels] = await Promise.all([
        prisma.studentProfile.groupBy({
          by: ['gradeLevelId', 'gender'],
          where: { user: { status: 'ACTIVE', archivedAt: null } },
          _count: { _all: true },
        }),
        prisma.gradeLevel.findMany({ where: { archivedAt: null }, select: { id: true, name: true }, orderBy: { order: 'asc' } }),
      ]);
      const genders = Object.keys(GENDER_LABELS).filter((g) => groups.some((x) => x.gender === g));
      const count = (levelId: string, gender: string) => groups.find((x) => x.gradeLevelId === levelId && x.gender === gender)?._count._all ?? 0;
      const total = groups.reduce((s, g) => s + g._count._all, 0);
      return {
        summary: `Enrollment: ${total} active students across ${levels.length} grade levels. ${levels
          .map((l) => `${l.name} ${genders.reduce((s, g) => s + count(l.id, g), 0)}`)
          .join(', ')}`,
        xAxis: levels.map((l) => l.name),
        series: genders.map((g) => ({ id: g, label: GENDER_LABELS[g], data: levels.map((l) => count(l.id, g)), stack: 'gender' })),
      };
    },
    ['dash', 'admin', 'enrollment'],
    ADMIN_CACHE,
  );
}

/** FR-19: 10 % buckets of every (student, course) term percent, plus average and median. */
export async function getGradeDistribution(termId?: string) {
  const id = termId ?? (await currentTerm())?.id ?? 'none';
  return cached(
    async () => {
      const percents = id === 'none' ? [] : [...(await loadTermPercents(id)).values()].flat().map((p) => p.percent).filter((p): p is number => p !== null);
      const buckets = Array<number>(10).fill(0);
      for (const p of percents) buckets[Math.min(9, Math.max(0, Math.floor(p / 10)))]++;
      const sorted = [...percents].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median = sorted.length ? Math.round((sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10 : null;
      const average = sorted.length ? Math.round((sorted.reduce((s, p) => s + p, 0) / sorted.length) * 10) / 10 : null;
      const xAxis = buckets.map((_, i) => (i === 9 ? '90–100' : `${i * 10}–${i * 10 + 9}`));
      return {
        summary: sorted.length
          ? `Grade distribution: ${sorted.length} course grades, average ${average} %, median ${median} %`
          : 'Grade distribution: no grades this term yet',
        xAxis,
        series: [{ id: 'count', label: 'Course grades', data: buckets }],
        average,
        median,
      } satisfies ChartSeries & { average: number | null; median: number | null };
    },
    ['dash', 'admin', 'grades', id],
    ADMIN_CACHE,
  );
}

/** FR-21: next 5 school-wide events, recurrences expanded. Not cached (cheap). */
export async function getUpcomingEvents() {
  const tz = await getSchoolTimezone();
  const now = new Date();
  const to = new Date(now.getTime() + 90 * DAY);
  const events = await prisma.calendarEvent.findMany({
    where: { audiences: { some: { type: 'SCHOOL' } }, startAt: { lt: to }, OR: [{ endAt: { gt: now } }, { recurrence: { not: 'NONE' } }] },
    select: { id: true, title: true, startAt: true, endAt: true, allDay: true, recurrence: true, recurrenceUntil: true },
    take: 50,
  });
  return events
    .flatMap((e) =>
      expandOccurrences(e, now, to, tz).map((o) => ({
        eventId: e.id,
        title: e.title,
        startsAt: o.start.toISOString(),
        endsAt: o.end.toISOString() as string | null,
        allDay: e.allDay,
      })),
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 5);
}

const ACTIVITY_PREFIXES = ['user.', 'report_card.', 'settings.'];

/** FR-22: latest 10 audit entries for user, report-card and settings changes. */
export async function getRecentActivity() {
  const rows = await prisma.auditLog.findMany({
    where: { OR: ACTIVITY_PREFIXES.map((p) => ({ action: { startsWith: p } })) },
    select: { id: true, action: true, entityType: true, entityId: true, createdAt: true, actor: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    actorName: r.actor ? `${r.actor.firstName} ${r.actor.lastName}` : null,
    entityType: r.entityType,
    entityId: r.entityId,
    createdAt: r.createdAt.toISOString(),
  }));
}
