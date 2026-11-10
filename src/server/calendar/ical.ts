import { formatInTimeZone, getTimezoneOffset } from 'date-fns-tz';
import { addDateDays, schoolDateOf, schoolMidnight } from '@/lib/dates';

/**
 * PRD-14 RFC 5545 builder (FR-12, FR-26, NFR-3, NFR-6, ADR-5). Pure, no I/O.
 * - all-day: DTSTART/DTEND;VALUE=DATE with an exclusive DTEND
 * - timed one-off: UTC 'Z' times
 * - series: TZID + RRULE (UNTIL in UTC, end of the until day), VTIMEZONE in the calendar
 * - deadlines: zero-duration VEVENT with URL
 * Lines end in CRLF and are folded at 75 octets.
 */

export interface IcalItem {
  uid: string;
  title: string;
  description?: string | null;
  location?: string | null;
  start: Date;
  /** Exclusive for all-day; equals start for deadlines. */
  end: Date;
  allDay: boolean;
  url?: string | null;
  category?: string | null;
  recurrence?: { freq: 'WEEKLY' | 'MONTHLY'; until: string } | null;
}

const CRLF = '\r\n';
const DAY_MS = 86_400_000;

export function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Folds one content line at 75 octets (UTF-8), never splitting a character. */
export function foldLine(line: string): string {
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, 'utf8');
    if (bytes + size > limit) {
      parts.push(current);
      current = ' ';
      bytes = 1;
      limit = 75;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join(CRLF);
}

const utcStamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const localStamp = (d: Date, tz: string) => formatInTimeZone(d, tz, "yyyyMMdd'T'HHmmss");
const dateValue = (dateStr: string) => dateStr.replace(/-/g, '');

function formatOffset(ms: number): string {
  const sign = ms < 0 ? '-' : '+';
  const minutes = Math.abs(ms) / 60_000;
  return `${sign}${String(Math.floor(minutes / 60)).padStart(2, '0')}${String(minutes % 60).padStart(2, '0')}`;
}

/** VTIMEZONE with every offset transition from a year before `from` to `to`. */
export function vtimezone(tz: string, from: Date, to: Date): string[] {
  const offset = (t: number) => getTimezoneOffset(tz, new Date(t));
  const transitions: { at: number; before: number; after: number }[] = [];
  const end = to.getTime();
  let prev = from.getTime() - 366 * DAY_MS;
  let prevOffset = offset(prev);
  for (let t = prev + DAY_MS; t <= end + DAY_MS; t += DAY_MS) {
    const o = offset(t);
    if (o !== prevOffset) {
      let lo = prev;
      let hi = t; // offset(lo) = prevOffset, offset(hi) = o
      while (hi - lo > 60_000) {
        const mid = lo + Math.floor((hi - lo) / 2);
        if (offset(mid) === prevOffset) lo = mid;
        else hi = mid;
      }
      transitions.push({ at: hi, before: prevOffset, after: o });
    }
    prev = t;
    prevOffset = o;
  }

  const lines = ['BEGIN:VTIMEZONE', `TZID:${tz}`];
  if (transitions.length === 0) {
    const o = formatOffset(offset(from.getTime()));
    lines.push('BEGIN:STANDARD', 'DTSTART:19700101T000000', `TZOFFSETFROM:${o}`, `TZOFFSETTO:${o}`, 'END:STANDARD');
  }
  for (const tr of transitions) {
    const kind = tr.after > tr.before ? 'DAYLIGHT' : 'STANDARD';
    // DTSTART is the local time of the transition, in the offset in force before it.
    const local = new Date(Math.round((tr.at + tr.before) / 60_000) * 60_000).toISOString();
    lines.push(
      `BEGIN:${kind}`,
      `DTSTART:${local.slice(0, 19).replace(/[-:]/g, '')}`,
      `TZOFFSETFROM:${formatOffset(tr.before)}`,
      `TZOFFSETTO:${formatOffset(tr.after)}`,
      `END:${kind}`,
    );
  }
  lines.push('END:VTIMEZONE');
  return lines;
}

export function vevent(item: IcalItem, tz: string, now: Date = new Date()): string[] {
  const lines = ['BEGIN:VEVENT', `UID:${item.uid}@schoolhub`, `DTSTAMP:${utcStamp(now)}`];

  if (item.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${dateValue(schoolDateOf(item.start, tz))}`);
    lines.push(`DTEND;VALUE=DATE:${dateValue(schoolDateOf(item.end, tz))}`);
  } else if (item.recurrence) {
    lines.push(`DTSTART;TZID=${tz}:${localStamp(item.start, tz)}`);
    lines.push(`DTEND;TZID=${tz}:${localStamp(item.end, tz)}`);
  } else {
    lines.push(`DTSTART:${utcStamp(item.start)}`);
    lines.push(`DTEND:${utcStamp(item.end)}`);
  }

  if (item.recurrence) {
    // UNTIL is inclusive of the whole until-day. DATE-valued for all-day series (RFC 5545 §3.3.10).
    const until = item.allDay
      ? dateValue(item.recurrence.until)
      : utcStamp(new Date(schoolMidnight(addDateDays(item.recurrence.until, 1), tz).getTime() - 1000));
    const byMonthDay = item.recurrence.freq === 'MONTHLY' ? `;BYMONTHDAY=${Number(formatInTimeZone(item.start, tz, 'd'))}` : '';
    lines.push(`RRULE:FREQ=${item.recurrence.freq};UNTIL=${until}${byMonthDay}`);
  }

  lines.push(`SUMMARY:${escapeText(item.title)}`);
  if (item.description) lines.push(`DESCRIPTION:${escapeText(item.description)}`);
  if (item.location) lines.push(`LOCATION:${escapeText(item.location)}`);
  if (item.category) lines.push(`CATEGORIES:${escapeText(item.category)}`);
  if (item.url) lines.push(`URL:${item.url}`);
  lines.push('END:VEVENT');
  return lines;
}

export function buildCalendar(
  items: IcalItem[],
  tz: string,
  window: { from: Date; to: Date },
  opts: { name?: string; now?: Date } = {},
): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SchoolHub//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(opts.name ?? 'SchoolHub')}`,
    `X-WR-TIMEZONE:${tz}`,
    ...vtimezone(tz, window.from, window.to),
    ...items.flatMap((item) => vevent(item, tz, opts.now)),
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join(CRLF) + CRLF;
}
