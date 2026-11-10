import { revalidateTag, unstable_cache } from 'next/cache';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { getAccessibleStudentIds, type AccessUser } from '@/server/auth/student-access';
import { getSchoolTimezone } from '@/server/assignments/assignments-service';
import { greetingFor, schoolDateOf } from '@/lib/dates';
import type { AtRiskFilters } from '@/lib/validators/dashboards';
import { trendOf, type RiskLevel, type RiskReason } from './risk-rules';

/**
 * PRD-16 cache layer (§3.6, FR-23, NFR-3) and the snapshot readers shared by the at-risk
 * widget, the admin risk summary and the /insights/at-risk list.
 *
 * ponytail: unstable_cache is per process (ADR-3); add a shared cache handler for >1 instance.
 */

export const TAGS = {
  admin: 'dashboard:admin',
  teacher: 'dashboard:teacher',
  atRisk: 'insights:at-risk',
} as const;
export const ALL_TAGS = Object.values(TAGS);

export interface Cached<T> {
  data: T;
  computedAt: string;
}

const isOutsideNext = (e: unknown) => e instanceof Error && /^Invariant: (incrementalCache|static generation store) missing/.test(e.message);

/** unstable_cache wrapper returning { data, computedAt }. `fn` must return JSON-safe data (no Date/Decimal). */
export async function cached<T>(fn: () => Promise<T>, keyParts: string[], opts: { revalidate: number; tags: string[] }): Promise<Cached<T>> {
  const run = async (): Promise<Cached<T>> => ({ data: await fn(), computedAt: new Date().toISOString() });
  try {
    return await unstable_cache(run, keyParts, opts)();
  } catch (e) {
    // Seed scripts and integration tests run outside a Next request: no cache, just compute.
    if (isOutsideNext(e)) return run();
    throw e;
  }
}

/** revalidateTag that is a no-op outside Next (seed, cron tests). */
export function revalidateTags(...tags: string[]) {
  for (const tag of tags) {
    try {
      revalidateTag(tag);
    } catch (e) {
      if (!isOutsideNext(e)) throw e;
    }
  }
}

const toDbDate = (d: string) => new Date(`${d}T00:00:00Z`);

/** The term containing school-today (NFR-7). Not react-cached, so it also works in scripts/tests. */
export async function currentTerm(now = new Date()) {
  const today = schoolDateOf(now, await getSchoolTimezone());
  return prisma.term.findFirst({
    where: { startDate: { lte: toDbDate(today) }, endDate: { gte: toDbDate(today) } },
    select: { id: true, name: true, academicYearId: true, startDate: true, endDate: true },
  });
}

// ---------------------------------------------------------------------------
// Snapshot readers (FR-7, FR-20, FR-29, FR-42)
// ---------------------------------------------------------------------------

export interface AtRiskRow {
  studentId: string;
  studentName: string;
  sectionId: string | null;
  sectionName: string | null;
  gradeLevel: string | null;
  level: RiskLevel;
  reasons: RiskReason[];
  trend: 'up' | 'down' | 'flat';
  computedAt: string;
}

const LEVEL_ORDER: Record<RiskLevel, number> = { HIGH: 0, MEDIUM: 1 };

/**
 * Current-term snapshots with a level, scoped to what `user` can see. Filters are
 * intersected with the scope, so they never widen it (FR-42). Sorted HIGH first,
 * then by number of reasons, then by name.
 */
export async function loadAtRiskRows(user: AccessUser, filters: AtRiskFilters = {}): Promise<AtRiskRow[]> {
  const term = await currentTerm();
  if (!term) return [];
  const scope = await getAccessibleStudentIds(user);
  if (scope !== 'ALL' && scope.length === 0) return [];

  const sectionFilter: Prisma.SectionWhereInput = {
    academicYearId: term.academicYearId,
    ...(filters.sectionId ? { id: filters.sectionId } : {}),
    ...(filters.gradeLevel ? { gradeLevelId: filters.gradeLevel } : {}),
  };
  const snapshots = await prisma.studentRiskSnapshot.findMany({
    where: {
      termId: term.id,
      level: filters.level ?? { not: null },
      ...(scope === 'ALL' ? {} : { studentId: { in: scope } }),
      ...(filters.sectionId || filters.gradeLevel ? { student: { sectionMemberships: { some: { section: sectionFilter } } } } : {}),
    },
    select: {
      studentId: true,
      level: true,
      previousLevel: true,
      reasons: true,
      computedAt: true,
      student: {
        select: {
          firstName: true,
          lastName: true,
          sectionMemberships: {
            where: { academicYearId: term.academicYearId },
            select: { section: { select: { id: true, name: true, gradeLevel: { select: { name: true } } } } },
          },
        },
      },
    },
  });

  return snapshots
    .map((s) => {
      const section = s.student.sectionMemberships[0]?.section ?? null;
      return {
        studentId: s.studentId,
        studentName: `${s.student.firstName} ${s.student.lastName}`,
        sectionId: section?.id ?? null,
        sectionName: section?.name ?? null,
        gradeLevel: section?.gradeLevel.name ?? null,
        level: s.level!,
        reasons: s.reasons as unknown as RiskReason[],
        trend: trendOf(s.level, s.previousLevel),
        computedAt: s.computedAt.toISOString(),
      };
    })
    .filter((r) => !filters.reason || r.reasons.some((x) => x.signal === filters.reason))
    .sort(
      (a, b) =>
        LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] ||
        b.reasons.length - a.reasons.length ||
        a.studentName.localeCompare(b.studentName),
    );
}

const riskKey = (user: AccessUser) => (user.role === 'ADMIN' ? ['risk', 'admin'] : ['risk', 'teacher', user.id]);

/** FR-20: counts by level and by reason. Cached 1 h per scope. */
export function getRiskSummary(user: AccessUser) {
  return cached(
    async () => {
      const rows = await loadAtRiskRows(user);
      const byLevel = { HIGH: 0, MEDIUM: 0 };
      const byReason = { ATTENDANCE: 0, GRADES: 0, MISSING: 0 };
      for (const r of rows) {
        byLevel[r.level]++;
        for (const reason of r.reasons) byReason[reason.signal]++;
      }
      return { byLevel, byReason };
    },
    [...riskKey(user), 'summary'],
    { revalidate: 3600, tags: [TAGS.atRisk] },
  );
}

/** FR-7: the top `n` at-risk students in scope. Cached 1 h per scope. */
export function getTopAtRisk(user: AccessUser, n = 5) {
  return cached(async () => (await loadAtRiskRows(user)).slice(0, n), [...riskKey(user), 'top', String(n)], {
    revalidate: 3600,
    tags: [TAGS.atRisk],
  });
}

/** FR-3: the greeting block shared by the three dashboard API payloads. */
export async function getGreeting(firstName: string, now = new Date()) {
  const [tz, term] = await Promise.all([getSchoolTimezone(), currentTerm(now)]);
  return { text: greetingFor(now, tz), firstName, date: schoolDateOf(now, tz), termName: term?.name ?? null };
}
