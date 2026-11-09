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
