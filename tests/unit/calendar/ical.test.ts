import { describe, expect, it } from 'vitest';
import ical, { type VEvent } from 'node-ical';
import { buildCalendar, escapeText, foldLine, vevent } from '@/server/calendar/ical';

const tz = 'America/New_York';
const now = new Date('2026-11-10T12:00:00Z');
const window = { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2027-10-01T00:00:00Z') };

describe('escapeText / foldLine', () => {
  it('escapes , ; \\ and newlines', () => {
    expect(escapeText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
  });

  it('folds at 75 octets with CRLF + space, never splitting multibyte chars', () => {
    const folded = foldLine(`SUMMARY:${'é'.repeat(80)}`);
    const lines = folded.split('\r\n');
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(Buffer.byteLength(l, 'utf8')).toBeLessThanOrEqual(75);
    expect(lines.slice(1).every((l) => l.startsWith(' '))).toBe(true);
    expect(lines.map((l, i) => (i ? l.slice(1) : l)).join('')).toBe(`SUMMARY:${'é'.repeat(80)}`);
  });
});

describe('vevent', () => {
  it('all-day uses VALUE=DATE with an exclusive end, across DST', () => {
    const lines = vevent(
      { uid: 'h', title: 'Break', start: new Date('2026-10-31T04:00:00Z'), end: new Date('2026-11-02T05:00:00Z'), allDay: true },
      tz,
      now,
    );
    expect(lines).toContain('DTSTART;VALUE=DATE:20261031');
    expect(lines).toContain('DTEND;VALUE=DATE:20261102');
  });

  it('one-off timed uses UTC Z; series uses TZID + RRULE with UTC UNTIL', () => {
    const oneOff = vevent({ uid: 'o', title: 'x', start: new Date('2026-11-12T23:00:00Z'), end: new Date('2026-11-13T00:00:00Z'), allDay: false }, tz, now);
    expect(oneOff).toContain('DTSTART:20261112T230000Z');
    const series = vevent(
      {
        uid: 's',
        title: 'Chess',
        start: new Date('2026-09-01T19:30:00Z'),
        end: new Date('2026-09-01T20:30:00Z'),
        allDay: false,
        recurrence: { freq: 'WEEKLY', until: '2026-12-15' },
      },
      tz,
      now,
    );
    expect(series).toContain(`DTSTART;TZID=${tz}:20260901T153000`);
    expect(series).toContain('RRULE:FREQ=WEEKLY;UNTIL=20261216T045959Z');
  });
});

describe('buildCalendar parsed by node-ical (NFR-6)', () => {
  const body = buildCalendar(
    [
      { uid: 'e1', title: 'Fair, science; fun', description: 'Line 1\nLine 2', location: 'Hall, A', start: new Date('2026-11-20T14:00:00Z'), end: new Date('2026-11-20T17:00:00Z'), allDay: false },
      { uid: 'e2', title: 'Thanksgiving break', start: new Date('2026-11-26T05:00:00Z'), end: new Date('2026-11-28T05:00:00Z'), allDay: true },
      {
        uid: 'e3',
        title: 'Chess club',
        start: new Date('2026-10-27T19:30:00Z'),
        end: new Date('2026-10-27T20:30:00Z'),
        allDay: false,
        recurrence: { freq: 'WEEKLY', until: '2026-11-17' },
      },
      { uid: 'a1', title: 'Essay due', start: new Date('2026-11-15T04:59:00Z'), end: new Date('2026-11-15T04:59:00Z'), allDay: false, url: 'http://localhost:3000/courses/c/assignments/a' },
      { uid: 'm1', title: 'Monthly', start: new Date('2027-01-31T15:00:00Z'), end: new Date('2027-01-31T16:00:00Z'), allDay: false, recurrence: { freq: 'MONTHLY', until: '2027-05-31' } },
    ],
    tz,
    window,
    { now },
  );
  const parsed = ical.sync.parseICS(body);
  const ev = (uid: string) => Object.values(parsed).find((c) => c?.type === 'VEVENT' && (c as { uid?: string }).uid === `${uid}@schoolhub`) as VEvent;

  it('is CRLF-terminated with folded lines', () => {
    expect(body.endsWith('\r\n')).toBe(true);
    expect(body.split('\r\n').every((l) => Buffer.byteLength(l, 'utf8') <= 75)).toBe(true);
    expect(body).toContain('BEGIN:VTIMEZONE');
  });

  it('round-trips escaped text', () => {
    expect(ev('e1').summary).toBe('Fair, science; fun');
    expect(ev('e1').description).toBe('Line 1\nLine 2');
    expect(ev('e1').location).toBe('Hall, A');
  });

  it('all-day is a date with exclusive end', () => {
    const e = ev('e2');
    expect(e.start.dateOnly).toBe(true);
    expect(e.datetype).toBe('date');
  });

  it('weekly RRULE keeps 15:30 local across DST', () => {
    const dates = ev('e3').rrule!.all().map((d: Date) => d.toISOString());
    expect(dates.length).toBe(4);
    const startTimes = ical
      .expandRecurringEvent(ev('e3'), { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-12-01T00:00:00Z') })
      .map((i) => i.start.toISOString());
    expect(startTimes).toEqual(['2026-10-27T19:30:00.000Z', '2026-11-03T20:30:00.000Z', '2026-11-10T20:30:00.000Z', '2026-11-17T20:30:00.000Z']);
  });

  it('monthly RRULE with BYMONTHDAY skips short months', () => {
    expect(body).toContain('BYMONTHDAY=31');
    expect(ev('m1').rrule!.all().length).toBe(3); // Jan, Mar, May
  });

  it('deadline is zero-duration with a URL', () => {
    const e = ev('a1');
    expect(e.end!.getTime()).toBe(e.start.getTime());
    expect(e.url).toBe('http://localhost:3000/courses/c/assignments/a');
  });
});
