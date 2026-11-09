import { formatInSchoolTz } from '@/lib/dates';

/**
 * PRD-07 pure rules (FR-8, FR-19, FR-22, FR-26, FR-28). No DB imports, so
 * unit tests and the client (DatePicker limits) can use it directly.
 * Dates are 'yyyy-MM-dd' strings in the school timezone (ADR-5).
 */

export type Status = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';
export type RuleRole = 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT';

export const TEACHER_WINDOW_DAYS = 14;
export const WINDOW_REASON = `Teachers can edit registers up to ${TEACHER_WINDOW_DAYS} days after the register date`;

export interface Rec {
  studentId: string;
  status: Status;
  minutesLate?: number | null;
  note?: string | null;
}

export function schoolToday(now: Date, tz: string): string {
  return formatInSchoolTz(now, 'yyyy-MM-dd', tz);
}

/** Whole days from `from` to `to` (both yyyy-MM-dd). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** yyyy-MM-dd shifted by n days. */
export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export type OpenResult = { ok: true } | { ok: false; code: 'FUTURE' | 'WINDOW'; reason: string };

/** FR-8: never the future; ADMIN any past date; TEACHER only the last 14 days. */
export function canOpen(role: RuleRole, date: string, today: string): OpenResult {
  if (date > today) return { ok: false, code: 'FUTURE', reason: 'Registers cannot be taken for future dates' };
  if (role === 'ADMIN') return { ok: true };
  if (role === 'TEACHER' && daysBetween(date, today) <= TEACHER_WINDOW_DAYS) return { ok: true };
  return { ok: false, code: 'WINDOW', reason: WINDOW_REASON };
}

/** FR-19: ADMIN always; TEACHER within 14 days of the register date. */
export function canEdit(role: RuleRole, date: string, today: string): { ok: boolean; reason?: string } {
  if (role === 'ADMIN') return { ok: true };
  if (role === 'TEACHER' && daysBetween(date, today) <= TEACHER_WINDOW_DAYS) return { ok: true };
  return { ok: false, reason: WINDOW_REASON };
}

export interface RecordDiff {
  created: Rec[];
  changed: { studentId: string; prev: Rec; next: Rec }[];
}

const norm = (r: Rec) => [r.status, r.minutesLate ?? null, r.note ?? null].join('|');

/** What a save actually writes; unchanged rows are dropped. */
export function diffRecords(prev: Map<string, Rec>, next: Rec[]): RecordDiff {
  const diff: RecordDiff = { created: [], changed: [] };
  for (const rec of next) {
    const old = prev.get(rec.studentId);
    if (!old) diff.created.push(rec);
    else if (norm(old) !== norm(rec)) diff.changed.push({ studentId: rec.studentId, prev: old, next: rec });
  }
  return diff;
}

/** FR-21/22: transitions into ABSENT / LATE, and ABSENT→PRESENT. New rows count as transitions from nothing. */
export function notificationsFor(diff: RecordDiff): { absent: Rec[]; late: Rec[]; corrected: Rec[] } {
  const out = { absent: [] as Rec[], late: [] as Rec[], corrected: [] as Rec[] };
  const moves = [
    ...diff.created.map((next) => ({ from: null as Status | null, next })),
    ...diff.changed.map((c) => ({ from: c.prev.status, next: c.next })),
  ];
  for (const { from, next } of moves) {
    if (from === next.status) continue;
    if (next.status === 'ABSENT') out.absent.push(next);
    else if (next.status === 'LATE') out.late.push(next);
    else if (next.status === 'PRESENT' && from === 'ABSENT') out.corrected.push(next);
  }
  return out;
}

export interface StatusCounts {
  records: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  rate: number | null;
}

/** FR-28: (P+L+E)/total×100, 1 dp; null with no records. */
export function attendanceRate(c: { present: number; absent: number; late: number; excused: number }): number | null {
  const total = c.present + c.absent + c.late + c.excused;
  if (total === 0) return null;
  return Math.round(((c.present + c.late + c.excused) / total) * 1000) / 10;
}

export function countStatuses(statuses: Iterable<Status>): StatusCounts {
  const c = { present: 0, absent: 0, late: 0, excused: 0 };
  for (const s of statuses) c[s.toLowerCase() as keyof typeof c] += 1;
  const records = c.present + c.absent + c.late + c.excused;
  return { records, ...c, rate: attendanceRate(c) };
}

export type DayColour = 'success' | 'warning' | 'error' | 'default';

/** FR-26: red if any absence, amber if any late, green otherwise; grey with no data. */
export function dayColour(statuses: Status[]): DayColour {
  if (statuses.length === 0) return 'default';
  if (statuses.includes('ABSENT')) return 'error';
  if (statuses.includes('LATE')) return 'warning';
  return 'success';
}
