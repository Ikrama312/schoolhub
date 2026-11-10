/**
 * PRD-16 FR-25/FR-26: pure early-warning rules. No Prisma import (NFR-9) — every
 * boundary is unit-tested in tests/unit/dashboards/risk-rules.test.ts.
 */
export type RiskLevel = 'MEDIUM' | 'HIGH';
export type RiskSignal = 'ATTENDANCE' | 'GRADES' | 'MISSING';

export interface RiskReason {
  signal: RiskSignal;
  level: RiskLevel;
  value: number;
  label: string;
}

/** Attendance below 80 % is always HIGH; below the school threshold (default 90) is MEDIUM. */
export const ATTENDANCE_HIGH_BELOW = 80;
export const GRADE_MEDIUM_BELOW = 60;
export const GRADE_HIGH_BELOW = 50;

const round1 = (n: number) => Math.round(n * 10) / 10;

export function formatReason(signal: RiskSignal, value: number): string {
  switch (signal) {
    case 'ATTENDANCE':
      return `Attendance ${round1(value)} %`;
    case 'GRADES':
      return `${value} course${value === 1 ? '' : 's'} < 60 %`;
    case 'MISSING':
      return `${value} missing`;
  }
}

const reason = (signal: RiskSignal, level: RiskLevel, value: number): RiskReason => ({
  signal,
  level,
  value,
  label: formatReason(signal, value),
});

export function attendanceSignal(pct: number | null, threshold: number): RiskReason | null {
  if (pct === null) return null;
  if (pct < ATTENDANCE_HIGH_BELOW) return reason('ATTENDANCE', 'HIGH', round1(pct));
  if (pct < threshold) return reason('ATTENDANCE', 'MEDIUM', round1(pct));
  return null;
}

/** value = number of courses below 60 %. Any course below 50 % makes it HIGH even when it's the only one. */
export function gradesSignal(coursePcts: (number | null)[]): RiskReason | null {
  const pcts = coursePcts.filter((p): p is number => p !== null);
  const below60 = pcts.filter((p) => p < GRADE_MEDIUM_BELOW).length;
  if (below60 === 0) return null;
  const high = below60 >= 2 || pcts.some((p) => p < GRADE_HIGH_BELOW);
  return reason('GRADES', high ? 'HIGH' : 'MEDIUM', below60);
}

export function missingSignal(count: number): RiskReason | null {
  if (count >= 5) return reason('MISSING', 'HIGH', count);
  if (count >= 3) return reason('MISSING', 'MEDIUM', count);
  return null;
}

export function overallLevel(signals: (RiskReason | null)[]): RiskLevel | null {
  const present = signals.filter((s): s is RiskReason => s !== null);
  if (present.some((s) => s.level === 'HIGH')) return 'HIGH';
  if (present.length >= 2) return 'HIGH';
  return present.length === 1 ? 'MEDIUM' : null;
}

const RANK: Record<string, number> = { HIGH: 2, MEDIUM: 1 };

/** FR-28/FR-29: 'up' when the level rose since previousLevel. */
export function trendOf(level: RiskLevel | null, previous: RiskLevel | null): 'up' | 'down' | 'flat' {
  const now = level ? RANK[level] : 0;
  const before = previous ? RANK[previous] : 0;
  return now > before ? 'up' : now < before ? 'down' : 'flat';
}
