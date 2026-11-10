import { z } from 'zod';
import { dateOnly } from './attendance';

/**
 * PRD-14 validation (FR-4, FR-21, FR-32, NFR-8). Client-safe: shared by the
 * event editor, the drawer and every calendar route handler. Rules that need
 * the school timezone or the caller (admin-only fields, audience targeting,
 * all-day RSVP deadline) live in calendar-service.
 */

export const EVENT_CATEGORIES = ['HOLIDAY', 'TERM_BREAK', 'EXAM', 'EVENT', 'MEETING', 'TRIP', 'SPORTS', 'DEADLINE', 'OTHER'] as const;
export const ADMIN_ONLY_CATEGORIES = ['HOLIDAY', 'TERM_BREAK'] as const;
export const RECURRENCES = ['NONE', 'WEEKLY', 'MONTHLY'] as const;
export const RSVP_RESPONSES = ['YES', 'NO', 'MAYBE'] as const;
export const AUDIENCE_TYPES = ['SCHOOL', 'STAFF', 'ROLE', 'GRADE_LEVEL', 'SECTION', 'COURSE'] as const;
export const CALENDAR_SOURCES = ['events', 'holidays', 'assignments', 'quizzes', 'timetable'] as const;
export const DEFAULT_SOURCES = ['events', 'holidays', 'assignments', 'quizzes'] as const;
const ROLES = ['ADMIN', 'TEACHER', 'STUDENT', 'PARENT'] as const;

export type EventCategoryValue = (typeof EVENT_CATEGORIES)[number];
export type CalendarSource = (typeof CALENDAR_SOURCES)[number];
export type AudienceTypeValue = (typeof AUDIENCE_TYPES)[number];

export const TITLE_MAX = 150;
export const DESCRIPTION_MAX = 5000;
export const LOCATION_MAX = 200;
export const RSVP_NOTE_MAX = 500;
export const GUESTS_MAX = 5;
export const MAX_AUDIENCES = 20;
export const MAX_RANGE_DAYS = 100;
const DAY_MS = 86_400_000;

export const CATEGORY_LABELS: Record<EventCategoryValue, string> = {
  HOLIDAY: 'Holiday',
  TERM_BREAK: 'Term break',
  EXAM: 'Exam',
  EVENT: 'Event',
  MEETING: 'Meeting',
  TRIP: 'Trip',
  SPORTS: 'Sports',
  DEADLINE: 'Deadline',
  OTHER: 'Other',
};

/** Category colours (FR-10), shared by the server merge and the UI chips. */
export const CATEGORY_COLORS: Record<EventCategoryValue, string> = {
  HOLIDAY: '#2E7D32',
  TERM_BREAK: '#558B2F',
  EXAM: '#C62828',
  EVENT: '#1565C0',
  MEETING: '#6A1B9A',
  TRIP: '#EF6C00',
  SPORTS: '#00838F',
  DEADLINE: '#AD1457',
  OTHER: '#546E7A',
};

export const SOURCE_LABELS: Record<CalendarSource, string> = {
  events: 'School events',
  assignments: 'My assignments',
  quizzes: 'My quizzes',
  timetable: 'My timetable',
  holidays: 'Holidays',
};

const isoDateTime = z.string().datetime({ offset: true });
const nullableText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer`)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

export const audienceInputSchema = z
  .object({
    type: z.enum(AUDIENCE_TYPES),
    refId: z.string().min(1).nullable().optional().transform((v) => v ?? null),
    includeStudents: z.boolean().default(true),
    includeParents: z.boolean().default(true),
    includeTeachers: z.boolean().default(true),
  })
  .superRefine((a, ctx) => {
    const global = a.type === 'SCHOOL' || a.type === 'STAFF';
    if (global && a.refId !== null) ctx.addIssue({ code: 'custom', path: ['refId'], message: `refId must be empty for ${a.type}` });
    if (!global && a.refId === null) ctx.addIssue({ code: 'custom', path: ['refId'], message: 'Choose who this is for' });
    if (a.type === 'ROLE' && a.refId !== null && !(ROLES as readonly string[]).includes(a.refId)) {
      ctx.addIssue({ code: 'custom', path: ['refId'], message: 'Unknown role' });
    }
    if (!global && a.type !== 'ROLE' && !a.includeStudents && !a.includeParents && !a.includeTeachers) {
      ctx.addIssue({ code: 'custom', path: ['includeStudents'], message: 'Include at least one group' });
    }
  });
export type AudienceInput = z.infer<typeof audienceInputSchema>;

const eventFields = z.object({
  title: z.string().trim().min(1, 'Title is required').max(TITLE_MAX, `Title must be ${TITLE_MAX} characters or fewer`),
  description: nullableText(DESCRIPTION_MAX, 'Description'),
  category: z.enum(EVENT_CATEGORIES),
  allDay: z.boolean().default(false),
  startAt: isoDateTime.nullable().optional(),
  endAt: isoDateTime.nullable().optional(),
  startDate: dateOnly.nullable().optional(),
  endDate: dateOnly.nullable().optional(),
  location: nullableText(LOCATION_MAX, 'Location'),
  roomId: z.string().min(1).nullable().optional(),
  recurrence: z.enum(RECURRENCES).default('NONE'),
  recurrenceUntil: dateOnly.nullable().optional(),
  isNoSchool: z.boolean().optional(),
  rsvpEnabled: z.boolean().default(false),
  rsvpDeadline: isoDateTime.nullable().optional(),
  isPublic: z.boolean().default(false),
  audiences: z.array(audienceInputSchema).min(1, 'Add at least one audience').max(MAX_AUDIENCES),
});

type EventFields = z.infer<typeof eventFields>;

/** Cross-field rules (FR-4). Exported so the service re-checks a merged PATCH with the same code. */
export function checkEvent(e: EventFields, ctx: z.RefinementCtx): void {
  let startDay: string | null = null;
  if (e.allDay) {
    if (!e.startDate) ctx.addIssue({ code: 'custom', path: ['startDate'], message: 'Start date is required' });
    if (!e.endDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'End date is required' });
    if (e.startDate && e.endDate && e.endDate < e.startDate) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'End date must be on or after the start date' });
    }
    startDay = e.startDate ?? null;
  } else {
    if (!e.startAt) ctx.addIssue({ code: 'custom', path: ['startAt'], message: 'Start time is required' });
    if (!e.endAt) ctx.addIssue({ code: 'custom', path: ['endAt'], message: 'End time is required' });
    if (e.startAt && e.endAt && Date.parse(e.endAt) < Date.parse(e.startAt)) {
      ctx.addIssue({ code: 'custom', path: ['endAt'], message: 'End must be on or after the start' });
    }
    if (e.startAt && e.rsvpEnabled && e.rsvpDeadline && Date.parse(e.rsvpDeadline) > Date.parse(e.startAt)) {
      ctx.addIssue({ code: 'custom', path: ['rsvpDeadline'], message: 'RSVP deadline must be before the event starts' });
    }
    // ponytail: UTC date of startAt; the service re-checks in the school timezone.
    startDay = e.startAt ? new Date(e.startAt).toISOString().slice(0, 10) : null;
  }

  if (e.recurrence === 'NONE') {
    if (e.recurrenceUntil) ctx.addIssue({ code: 'custom', path: ['recurrenceUntil'], message: 'Only repeating events have an end date' });
  } else if (!e.recurrenceUntil) {
    ctx.addIssue({ code: 'custom', path: ['recurrenceUntil'], message: 'Choose when the repeat ends' });
  } else if (startDay) {
    const start = Date.parse(`${startDay}T00:00:00Z`);
    const until = Date.parse(`${e.recurrenceUntil}T00:00:00Z`);
    // One day of slack either way: startDay is UTC for timed events.
    if (until < start - DAY_MS) ctx.addIssue({ code: 'custom', path: ['recurrenceUntil'], message: 'Repeat end must be on or after the start' });
    if (until > start + 366 * DAY_MS) ctx.addIssue({ code: 'custom', path: ['recurrenceUntil'], message: 'Repeat for at most one year' });
  }

  if (e.rsvpEnabled && !e.rsvpDeadline) {
    ctx.addIssue({ code: 'custom', path: ['rsvpDeadline'], message: 'RSVP deadline is required' });
  }
}

export const eventInputSchema = eventFields.superRefine(checkEvent);
export type EventInput = z.infer<typeof eventInputSchema>;
/** Form-side (pre-default) shape, for React Hook Form. */
export type EventFormValues = z.input<typeof eventInputSchema>;

/** PATCH: every field optional; cross-field rules run in the service on the merged event. */
export const eventPatchSchema = eventFields
  .partial()
  .refine((p) => Object.values(p).some((v) => v !== undefined), 'Change at least one field');
export type EventPatch = z.infer<typeof eventPatchSchema>;

export const rsvpSchema = z.object({
  response: z.enum(RSVP_RESPONSES),
  guests: z.number().int().min(0).max(GUESTS_MAX, `At most ${GUESTS_MAX} guests`).default(0),
  note: nullableText(RSVP_NOTE_MAX, 'Note'),
});
export type RsvpInput = z.infer<typeof rsvpSchema>;

const range = z
  .object({ from: isoDateTime, to: isoDateTime })
  .transform((r) => ({ from: new Date(r.from), to: new Date(r.to) }));

function checkRange(r: { from: Date; to: Date }, ctx: z.RefinementCtx) {
  if (!(r.from instanceof Date) || !(r.to instanceof Date)) return; // an earlier issue aborted the transform
  if (r.to <= r.from) ctx.addIssue({ code: 'custom', path: ['to'], message: '"to" must be after "from"' });
  else if (r.to.getTime() - r.from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: `Range must be ${MAX_RANGE_DAYS} days or fewer` });
  }
}

const sourcesParam = z
  .string()
  .optional()
  .transform((s, ctx) => {
    if (!s) return [...DEFAULT_SOURCES] as CalendarSource[];
    const list = [...new Set(s.split(',').map((x) => x.trim()).filter(Boolean))];
    const bad = list.filter((x) => !(CALENDAR_SOURCES as readonly string[]).includes(x));
    if (bad.length) {
      ctx.addIssue({ code: 'custom', message: `Unknown source: ${bad.join(', ')}` });
      return z.NEVER;
    }
    return list as CalendarSource[];
  });

export const calendarQuerySchema = z
  .object({ from: isoDateTime, to: isoDateTime, sources: sourcesParam, studentId: z.string().min(1).optional() })
  .transform((q) => ({ ...q, from: new Date(q.from), to: new Date(q.to) }))
  .superRefine(checkRange);
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;

export const schoolDayQuerySchema = z.object({ date: dateOnly });

export const publicEventsQuerySchema = range.superRefine(checkRange);
