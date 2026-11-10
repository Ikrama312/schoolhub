import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

/**
 * Formats a UTC date/ISO-string in the school's configured timezone
 * (SchoolSettings.timezone). pattern is a date-fns format string.
 */
export function formatInSchoolTz(
  date: Date | string,
  pattern: string,
  timezone: string,
): string {
  const value = typeof date === 'string' ? new Date(date) : date;
  return formatInTimeZone(value, timezone, pattern);
}

/** ISO weekday (1=Mon … 7=Sun) and 'HH:mm' wall clock in the school timezone. Never the browser's. */
export function schoolNow(now: Date, tz: string): { isoDay: number; hhmm: string } {
  return { isoDay: Number(formatInSchoolTz(now, 'i', tz)), hhmm: formatInSchoolTz(now, 'HH:mm', tz) };
}

/**
 * FR-10: 23:59 school-local on the first teaching weekday after today (looks ≤7 days ahead),
 * as a UTC instant. teachingDays are ISO weekdays (SchoolDay.dayOfWeek). No teaching day → tomorrow.
 */
export function nextTeachingDayDueAt(now: Date, tz: string, teachingDays: readonly number[]): Date {
  const today = formatInSchoolTz(now, 'yyyy-MM-dd', tz);
  const dayAt = (offset: number) => new Date(Date.parse(`${today}T12:00:00Z`) + offset * 86_400_000);
  let target = dayAt(1);
  for (let offset = 1; offset <= 7; offset++) {
    const day = dayAt(offset);
    if (teachingDays.includes(day.getUTCDay() || 7)) {
      target = day;
      break;
    }
  }
  return fromZonedTime(`${target.toISOString().slice(0, 10)} 23:59`, tz);
}

/** The period running at hhmm ([start, end)) and the next one to start after hhmm. */
export function nowAndNext<P extends { startTime: string; endTime: string }>(
  periods: P[],
  hhmm: string,
): { now: P | null; next: P | null } {
  const sorted = [...periods].sort((a, b) => a.startTime.localeCompare(b.startTime));
  return {
    now: sorted.find((p) => p.startTime <= hhmm && hhmm < p.endTime) ?? null,
    next: sorted.find((p) => p.startTime > hhmm) ?? null,
  };
}

/** ISO weekday labels, index 1=Mon … 7=Sun (index 0 unused). */
export const ISO_DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * PRD-14 (FR-4, NFR-3): the UTC instant of 00:00 school-local on `dateStr` (yyyy-MM-dd).
 * All-day events are stored as [schoolMidnight(start), schoolMidnight(end + 1 day)).
 */
export function schoolMidnight(dateStr: string, tz: string): Date {
  return fromZonedTime(`${dateStr}T00:00:00`, tz);
}

/** PRD-14: the school-tz calendar date (yyyy-MM-dd) an instant falls on. */
export function schoolDateOf(instant: Date | string, tz: string): string {
  return formatInSchoolTz(instant, 'yyyy-MM-dd', tz);
}

/** Calendar-date arithmetic on yyyy-MM-dd strings (no timezone involved). */
export function addDateDays(dateStr: string, days: number): string {
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** PRD-16 FR-3: greeting by the school-tz hour: [05,12) morning, [12,17) afternoon, otherwise evening. */
export function greetingFor(now: Date, tz: string): 'Good morning' | 'Good afternoon' | 'Good evening' {
  const hour = Number(formatInSchoolTz(now, 'H', tz));
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * PRD-16 FR-17: the last `n` school days up to today (school tz), ascending. A school day is
 * a date with at least one AttendanceSession; callers pass those dates (yyyy-MM-dd) in, so this
 * module stays free of DB imports (it is also used by client components).
 */
export function schoolDaysBack(n: number, tz: string, sessionDates: Iterable<string>, now: Date = new Date()): string[] {
  const today = schoolDateOf(now, tz);
  return [...new Set(sessionDates)]
    .filter((d) => d <= today)
    .sort()
    .slice(-n);
}
