import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

/**
 * PRD-14 FR-15 / ADR-3: read-time expansion of a recurring event. Pure.
 * Steps in school-tz wall-clock time, so a 15:30 club stays at 15:30 across a
 * DST change. WEEKLY = +7 days; MONTHLY = same day of month, months without that
 * day are skipped. recurrenceUntil is inclusive (the whole school-tz day).
 */

export interface RecurringEvent {
  id: string;
  startAt: Date;
  endAt: Date;
  recurrence: 'NONE' | 'WEEKLY' | 'MONTHLY';
  /** Prisma @db.Date (UTC midnight of the date) or 'yyyy-MM-dd'. */
  recurrenceUntil: Date | string | null;
}

export interface Occurrence {
  /** `${eventId}:${startISO}` */
  id: string;
  eventId: string;
  start: Date;
  end: Date;
}

const DAY_MS = 86_400_000;
const MAX_STEPS = 400; // ≤ 1 year of weekly/monthly, with headroom

/** Wall-clock time in tz as a "naive" epoch (the local fields read as if UTC). */
function naive(d: Date, tz: string): number {
  return Date.parse(`${formatInTimeZone(d, tz, "yyyy-MM-dd'T'HH:mm:ss.SSS")}Z`);
}

function fromNaive(ms: number, tz: string): Date {
  return fromZonedTime(new Date(ms).toISOString().slice(0, 23), tz);
}

function untilDate(u: Date | string): string {
  return typeof u === 'string' ? u.slice(0, 10) : u.toISOString().slice(0, 10);
}

function overlaps(start: Date, end: Date, from: Date, to: Date): boolean {
  if (start >= to) return false;
  return end > from || (end.getTime() === start.getTime() && start >= from);
}

export function expandOccurrences(event: RecurringEvent, from: Date, to: Date, tz: string): Occurrence[] {
  const make = (start: Date, end: Date): Occurrence => ({
    id: `${event.id}:${start.toISOString()}`,
    eventId: event.id,
    start,
    end,
  });

  if (event.recurrence === 'NONE' || !event.recurrenceUntil) {
    return overlaps(event.startAt, event.endAt, from, to) ? [make(event.startAt, event.endAt)] : [];
  }

  const start0 = naive(event.startAt, tz);
  const duration = naive(event.endAt, tz) - start0;
  const until = untilDate(event.recurrenceUntil);
  const base = new Date(start0);
  const out: Occurrence[] = [];

  for (let k = 0; k < MAX_STEPS; k++) {
    let localStart: number;
    if (event.recurrence === 'WEEKLY') {
      localStart = start0 + k * 7 * DAY_MS;
    } else {
      const y = base.getUTCFullYear();
      const m = base.getUTCMonth() + k;
      const day = base.getUTCDate();
      const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      if (day > daysInMonth) continue; // e.g. the 31st in a 30-day month
      localStart = Date.UTC(y, m, day) + (start0 % DAY_MS);
    }
    if (new Date(localStart).toISOString().slice(0, 10) > until) break;
    const start = fromNaive(localStart, tz);
    if (start >= to) break;
    const end = fromNaive(localStart + duration, tz);
    if (overlaps(start, end, from, to)) out.push(make(start, end));
  }
  return out;
}
