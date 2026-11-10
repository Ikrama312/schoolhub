import { describe, expect, it } from 'vitest';
import {
  audienceInputSchema,
  calendarQuerySchema,
  eventInputSchema,
  eventPatchSchema,
  publicEventsQuerySchema,
  rsvpSchema,
  schoolDayQuerySchema,
} from '@/lib/validators/calendar';

const audience = [{ type: 'SCHOOL', refId: null }];
const timed = {
  title: 'Concert',
  category: 'EVENT',
  allDay: false,
  startAt: '2026-12-01T18:00:00Z',
  endAt: '2026-12-01T20:00:00Z',
  audiences: audience,
};

describe('eventInputSchema', () => {
  it('accepts a timed event and applies defaults', () => {
    const e = eventInputSchema.parse(timed);
    expect(e.recurrence).toBe('NONE');
    expect(e.rsvpEnabled).toBe(false);
    expect(e.audiences[0]).toMatchObject({ includeStudents: true, includeParents: true, includeTeachers: true });
  });

  it('rejects title > 150, description > 5000, endAt < startAt', () => {
    expect(eventInputSchema.safeParse({ ...timed, title: 'x'.repeat(151) }).success).toBe(false);
    expect(eventInputSchema.safeParse({ ...timed, description: 'x'.repeat(5001) }).success).toBe(false);
    expect(eventInputSchema.safeParse({ ...timed, endAt: '2026-12-01T17:00:00Z' }).success).toBe(false);
  });

  it('all-day needs dates with an inclusive end ≥ start', () => {
    const allDay = { ...timed, allDay: true, startAt: null, endAt: null, startDate: '2026-12-21', endDate: '2027-01-01' };
    expect(eventInputSchema.safeParse(allDay).success).toBe(true);
    expect(eventInputSchema.safeParse({ ...allDay, startDate: '2026-12-21', endDate: '2026-12-20' }).success).toBe(false);
    expect(eventInputSchema.safeParse({ ...allDay, endDate: null }).success).toBe(false);
  });

  it('recurrence needs an until ≤ 1 year after the start, and NONE forbids one', () => {
    expect(eventInputSchema.safeParse({ ...timed, recurrence: 'WEEKLY' }).success).toBe(false);
    expect(eventInputSchema.safeParse({ ...timed, recurrence: 'WEEKLY', recurrenceUntil: '2027-06-01' }).success).toBe(true);
    expect(eventInputSchema.safeParse({ ...timed, recurrence: 'MONTHLY', recurrenceUntil: '2028-01-01' }).success).toBe(false);
    expect(eventInputSchema.safeParse({ ...timed, recurrenceUntil: '2027-01-01' }).success).toBe(false);
  });

  it('RSVP needs a deadline before the start', () => {
    expect(eventInputSchema.safeParse({ ...timed, rsvpEnabled: true }).success).toBe(false);
    expect(eventInputSchema.safeParse({ ...timed, rsvpEnabled: true, rsvpDeadline: '2026-12-02T00:00:00Z' }).success).toBe(false);
    expect(eventInputSchema.safeParse({ ...timed, rsvpEnabled: true, rsvpDeadline: '2026-11-30T00:00:00Z' }).success).toBe(true);
  });

  it('audiences: 1..20', () => {
    expect(eventInputSchema.safeParse({ ...timed, audiences: [] }).success).toBe(false);
    expect(eventInputSchema.safeParse({ ...timed, audiences: Array(21).fill(audience[0]) }).success).toBe(false);
  });
});

describe('audienceInputSchema', () => {
  it('SCHOOL/STAFF take no refId; others require one', () => {
    expect(audienceInputSchema.safeParse({ type: 'STAFF', refId: 'x' }).success).toBe(false);
    expect(audienceInputSchema.safeParse({ type: 'COURSE' }).success).toBe(false);
    expect(audienceInputSchema.safeParse({ type: 'COURSE', refId: 'c1' }).success).toBe(true);
  });
  it('ROLE refId must be a role; grade audience needs one include flag', () => {
    expect(audienceInputSchema.safeParse({ type: 'ROLE', refId: 'JANITOR' }).success).toBe(false);
    expect(audienceInputSchema.safeParse({ type: 'ROLE', refId: 'PARENT' }).success).toBe(true);
    expect(
      audienceInputSchema.safeParse({ type: 'GRADE_LEVEL', refId: 'g', includeStudents: false, includeParents: false, includeTeachers: false }).success,
    ).toBe(false);
  });
});

describe('eventPatchSchema', () => {
  it('needs at least one field and does not apply defaults', () => {
    expect(eventPatchSchema.safeParse({}).success).toBe(false);
    expect(eventPatchSchema.parse({ title: 'New' })).toEqual({ title: 'New' });
  });
});

describe('rsvpSchema', () => {
  it('guests 0..5, note ≤ 500', () => {
    expect(rsvpSchema.parse({ response: 'YES' })).toEqual({ response: 'YES', guests: 0, note: null });
    expect(rsvpSchema.safeParse({ response: 'YES', guests: 6 }).success).toBe(false);
    expect(rsvpSchema.safeParse({ response: 'NO', note: 'x'.repeat(501) }).success).toBe(false);
  });
});

describe('range queries', () => {
  it('calendarQuery: ≤ 100 days, to > from, known sources, defaults', () => {
    const q = calendarQuerySchema.parse({ from: '2026-11-01T00:00:00Z', to: '2026-12-01T00:00:00Z' });
    expect(q.sources).toEqual(['events', 'holidays', 'assignments', 'quizzes']);
    expect(q.from).toBeInstanceOf(Date);
    expect(calendarQuerySchema.safeParse({ from: '2026-01-01T00:00:00Z', to: '2026-04-12T00:00:00Z' }).success).toBe(false);
    expect(calendarQuerySchema.safeParse({ from: '2026-01-02T00:00:00Z', to: '2026-01-01T00:00:00Z' }).success).toBe(false);
    expect(calendarQuerySchema.safeParse({ from: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z', sources: 'events,bogus' }).success).toBe(false);
    expect(calendarQuerySchema.parse({ from: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z', sources: 'timetable' }).sources).toEqual(['timetable']);
  });
  it('publicEvents and schoolDay', () => {
    expect(publicEventsQuerySchema.safeParse({ from: '2026-01-01T00:00:00Z', to: '2026-05-01T00:00:00Z' }).success).toBe(false);
    expect(schoolDayQuerySchema.safeParse({ date: '2026-02-30' }).success).toBe(false);
    expect(schoolDayQuerySchema.safeParse({ date: '2026-02-27' }).success).toBe(true);
  });
});
