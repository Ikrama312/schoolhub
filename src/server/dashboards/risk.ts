import type { AttendanceMode, Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import { logger } from '@/lib/logger';
import { assertCanViewStudent, type AccessUser } from '@/server/auth/student-access';
import { attendanceRate } from '@/server/attendance/attendance-rules';
import { notify } from '@/server/notifications/notify';
import { loadTermPercents } from '@/server/gradebook/batch-grades';
import { schoolDateOf } from '@/lib/dates';
import type { AtRiskFilters } from '@/lib/validators/dashboards';
import { missingWork } from './missing-work';
import { currentTerm, loadAtRiskRows, revalidateTags, TAGS, type AtRiskRow } from './insights';
import {
  attendanceSignal,
  gradesSignal,
  GRADE_MEDIUM_BELOW,
  missingSignal,
  overallLevel,
  trendOf,
  type RiskLevel,
  type RiskReason,
} from './risk-rules';

/**
 * PRD-16 early-warning engine (§3.3, FR-25–FR-32). Inputs are loaded in a fixed number of
 * grouped queries (NFR-1); the rules themselves are pure (risk-rules.ts).
 */

const MINUTE = 60_000;
const DAY = 86_400_000;
const FRESH_FOR_MS = 60 * MINUTE;
const NOTIFY_EVERY_MS = 14 * DAY;
const MISSING_WINDOW_MS = 30 * DAY;
const HISTORY_MAX = 10;
const CHUNK = 100;

export interface RiskSignals {
  attendancePct: number | null;
  coursesBelow60: number;
  lowestCoursePct: number | null;
  missingCount: number;
}

export interface HistoryEntry {
  level: RiskLevel | null;
  reasons: RiskReason[];
  computedAt: string;
}

type Term = NonNullable<Awaited<ReturnType<typeof currentTerm>>>;

const toDbDate = (d: string) => new Date(`${d}T00:00:00Z`);
const fromDbDate = (d: Date) => d.toISOString().slice(0, 10);

/** Same rule as attendance-service kindWhere (FR-28 of PRD-07): which sessions count toward rates. */
const kindWhere = (mode: AttendanceMode): Prisma.AttendanceSessionWhereInput =>
  mode === 'DAILY_HOMEROOM' ? { sectionId: { not: null } } : { courseId: { not: null } };

async function loadSettings() {
  const s = await prisma.schoolSettings.findUnique({ where: { id: 'singleton' } });
  return { tz: s?.timezone ?? 'UTC', mode: s?.attendanceMode ?? 'PER_PERIOD', threshold: s?.attendanceAlertThreshold ?? 90 };
}

/** Batched: one attendance groupBy, the batch grade loader and one missing-work window. */
export async function loadRiskInputs(term: Term, studentIds: string[], now = new Date()) {
  const { tz, mode, threshold } = await loadSettings();
  const today = schoolDateOf(now, tz);
  const end = fromDbDate(term.endDate) < today ? fromDbDate(term.endDate) : today;

  const [attendance, percents, missing] = await Promise.all([
    prisma.attendanceRecord.groupBy({
      by: ['studentId', 'status'],
      where: { studentId: { in: studentIds }, session: { date: { gte: term.startDate, lte: toDbDate(end) }, ...kindWhere(mode) } },
      _count: { _all: true },
    }),
    loadTermPercents(term.id, studentIds, now),
    missingWork({ studentIds, from: new Date(now.getTime() - MISSING_WINDOW_MS), to: now, now }),
  ]);

  const counts = new Map<string, { present: number; absent: number; late: number; excused: number }>();
  for (const g of attendance) {
    const c = counts.get(g.studentId) ?? { present: 0, absent: 0, late: 0, excused: 0 };
    c[g.status.toLowerCase() as keyof typeof c] += g._count._all;
    counts.set(g.studentId, c);
  }

  return new Map(
    studentIds.map((id) => {
      const c = counts.get(id);
      const pcts = (percents.get(id) ?? []).map((p) => p.percent);
      const known = pcts.filter((p): p is number => p !== null);
      return [
        id,
        {
          threshold,
          coursePcts: pcts,
          signals: {
            attendancePct: c ? attendanceRate(c) : null,
            coursesBelow60: known.filter((p) => p < GRADE_MEDIUM_BELOW).length,
            lowestCoursePct: known.length ? Math.min(...known) : null,
            missingCount: missing.get(id)?.length ?? 0,
          } satisfies RiskSignals,
        },
      ];
    }),
  );
}

export function evaluate(input: { threshold: number; coursePcts: (number | null)[]; signals: RiskSignals }) {
  const reasons = [
    attendanceSignal(input.signals.attendancePct, input.threshold),
    gradesSignal(input.coursePcts),
    missingSignal(input.signals.missingCount),
  ];
  return { level: overallLevel(reasons), reasons: reasons.filter((r): r is RiskReason => r !== null) };
}

/**
 * FR-27: hourly (DB-gated) or forced recompute. Upserts one row per (student, term),
 * appends history only on a level change, and claims + sends the FR-32 HIGH notification.
 */
export async function recomputeRiskSnapshots(
  opts: { force?: boolean; now?: Date } = {},
): Promise<{ skipped: 'no-term' | 'fresh' | null; studentsComputed: number }> {
  const now = opts.now ?? new Date();
  const term = await currentTerm(now);
  if (!term) return { skipped: 'no-term', studentsComputed: 0 };

  if (!opts.force) {
    const latest = await prisma.studentRiskSnapshot.aggregate({ where: { termId: term.id }, _max: { computedAt: true } });
    const last = latest._max.computedAt;
    if (last && now.getTime() - last.getTime() < FRESH_FOR_MS) return { skipped: 'fresh', studentsComputed: 0 };
  }

  const students = await prisma.user.findMany({
    where: {
      role: 'STUDENT',
      status: 'ACTIVE',
      archivedAt: null,
      OR: [
        { enrollments: { some: { status: 'ACTIVE', course: { academicYearId: term.academicYearId } } } },
        { sectionMemberships: { some: { academicYearId: term.academicYearId } } },
      ],
    },
    select: { id: true },
  });
  const studentIds = students.map((s) => s.id);
  const [inputs, existing] = await Promise.all([
    loadRiskInputs(term, studentIds, now),
    prisma.studentRiskSnapshot.findMany({
      where: { termId: term.id, studentId: { in: studentIds } },
      select: { studentId: true, level: true, history: true },
    }),
  ]);
  const old = new Map(existing.map((e) => [e.studentId, e]));
  const computedAt = now.toISOString();
  const becameHigh: { studentId: string; reasons: RiskReason[] }[] = [];

  const writes = studentIds.map((studentId) => {
    const input = inputs.get(studentId)!;
    const { level, reasons } = evaluate(input);
    const prev = old.get(studentId);
    const prevLevel = prev?.level ?? null;
    const base = {
      level,
      reasons: reasons as unknown as Prisma.InputJsonValue,
      signals: input.signals as unknown as Prisma.InputJsonValue,
      computedAt: now,
    };
    let changed: { previousLevel?: RiskLevel | null; history?: Prisma.InputJsonValue } = {};
    if (level !== prevLevel) {
      const history = [{ level, reasons, computedAt } satisfies HistoryEntry, ...((prev?.history as unknown as HistoryEntry[]) ?? [])].slice(0, HISTORY_MAX);
      changed = { previousLevel: prevLevel, history: history as unknown as Prisma.InputJsonValue };
      if (level === 'HIGH') becameHigh.push({ studentId, reasons });
    }
    return prisma.studentRiskSnapshot.upsert({
      where: { studentId_termId: { studentId, termId: term.id } },
      create: { studentId, termId: term.id, ...base, ...changed },
      update: { ...base, ...changed },
    });
  });
  for (let i = 0; i < writes.length; i += CHUNK) await prisma.$transaction(writes.slice(i, i + CHUNK));

  await notifyHighRisk(term, becameHigh, now);
  revalidateTags(TAGS.atRisk);
  return { skipped: null, studentsComputed: studentIds.length };
}

/** FR-32: atomic 14-day claim per student, then notify the homeroom teacher. */
async function notifyHighRisk(term: Term, students: { studentId: string; reasons: RiskReason[] }[], now: Date) {
  if (!students.length) return;
  const people = await prisma.user.findMany({
    where: { id: { in: students.map((s) => s.studentId) } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      sectionMemberships: { where: { academicYearId: term.academicYearId }, select: { section: { select: { homeroomTeacherId: true } } } },
    },
  });
  const byId = new Map(people.map((p) => [p.id, p]));

  for (const { studentId, reasons } of students) {
    const student = byId.get(studentId);
    const teacherId = student?.sectionMemberships[0]?.section.homeroomTeacherId;
    if (!student || !teacherId) {
      logger.warn('High-risk student has no homeroom teacher; notification skipped', { studentId });
      continue;
    }
    const claimed = await prisma.studentRiskSnapshot.updateMany({
      where: {
        studentId,
        termId: term.id,
        OR: [{ highNotifiedAt: null }, { highNotifiedAt: { lt: new Date(now.getTime() - NOTIFY_EVERY_MS) } }],
      },
      data: { highNotifiedAt: now },
    });
    if (claimed.count !== 1) continue;
    const name = `${student.firstName} ${student.lastName}`;
    await notify({
      type: 'insights.student_high_risk',
      userIds: [teacherId],
      title: `${name} is now at high risk`,
      body: reasons.map((r) => r.label).join(' · '),
      link: `/students/${studentId}/insights`,
      email: { template: 'generic-notification' },
    });
  }
}

// ---------------------------------------------------------------------------
// Readers (FR-29, FR-30, FR-31, FR-42, FR-43)
// ---------------------------------------------------------------------------

export const AT_RISK_COLUMNS = [
  { key: 'studentName', header: 'Student' },
  { key: 'sectionName', header: 'Section' },
  { key: 'gradeLevel', header: 'Grade level' },
  { key: 'level', header: 'Level' },
  { key: 'reasons', header: 'Reasons' },
  { key: 'trend', header: 'Trend' },
  { key: 'computedAt', header: 'Computed at' },
];

export const atRiskCsvRow = (r: AtRiskRow) => ({ ...r, reasons: r.reasons.map((x) => x.label).join('; ') });

/** Paginated, or every row when `page` is omitted (CSV). */
export async function listAtRisk(user: AccessUser, filters: AtRiskFilters, page?: { page: number; pageSize: number }) {
  const rows = await loadAtRiskRows(user, filters);
  const computedAt = rows.reduce<string | null>((max, r) => (max && max > r.computedAt ? max : r.computedAt), null);
  if (!page) return { rows, total: rows.length, computedAt };
  const start = (page.page - 1) * page.pageSize;
  return { rows: rows.slice(start, start + page.pageSize), total: rows.length, computedAt };
}

export async function getStudentInsights(user: AccessUser, studentId: string) {
  const student = await prisma.user.findFirst({ where: { id: studentId, role: 'STUDENT' }, select: { id: true } });
  if (!student) throw new AppError('NOT_FOUND', 'Student not found');
  await assertCanViewStudent(user, studentId);

  const term = await currentTerm();
  const snap = term
    ? await prisma.studentRiskSnapshot.findUnique({ where: { studentId_termId: { studentId, termId: term.id } } })
    : null;
  return {
    studentId,
    termId: term?.id ?? null,
    level: snap?.level ?? null,
    previousLevel: snap?.previousLevel ?? null,
    trend: trendOf(snap?.level ?? null, snap?.previousLevel ?? null),
    reasons: (snap?.reasons as unknown as RiskReason[] | undefined) ?? [],
    signals: (snap?.signals as unknown as RiskSignals | undefined) ?? null,
    history: (snap?.history as unknown as HistoryEntry[] | undefined) ?? [],
    computedAt: snap?.computedAt.toISOString() ?? null,
  };
}
