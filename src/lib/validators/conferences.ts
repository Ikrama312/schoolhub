import { z } from 'zod';
import { dateOnly } from './attendance';
import { listParams, sortParam } from './absence-notes';

/**
 * PRD-15 conferences (FR-2, FR-28 to FR-32, NFR-7). Client-safe. "bookingClosesAt
 * ≤ end of `date` in the school timezone" needs the tz, so the service checks it.
 */

export const SLOT_MINUTES_MIN = 5;
export const SLOT_MINUTES_MAX = 60;
export const PARENT_NOTE_MAX = 500;
export const LOCATION_MAX = 200;
export const MAX_RANGES = 10;

const isoDateTime = z.string().datetime({ offset: true });
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');

const eventFields = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  date: dateOnly,
  bookingOpensAt: isoDateTime,
  bookingClosesAt: isoDateTime,
  slotMinutes: z
    .number()
    .int()
    .min(SLOT_MINUTES_MIN, `Slot length must be ${SLOT_MINUTES_MIN}–${SLOT_MINUTES_MAX} minutes`)
    .max(SLOT_MINUTES_MAX, `Slot length must be ${SLOT_MINUTES_MIN}–${SLOT_MINUTES_MAX} minutes`),
  gradeLevelIds: z.array(z.string().min(1)).min(1, 'Choose at least one grade level').max(20),
});

export function checkWindow(e: { bookingOpensAt?: string; bookingClosesAt?: string }, ctx: z.RefinementCtx) {
  if (e.bookingOpensAt && e.bookingClosesAt && Date.parse(e.bookingClosesAt) <= Date.parse(e.bookingOpensAt)) {
    ctx.addIssue({ code: 'custom', path: ['bookingClosesAt'], message: 'Booking must close after it opens' });
  }
}

export const conferenceEventInputSchema = eventFields.superRefine(checkWindow);
export type ConferenceEventInput = z.infer<typeof conferenceEventInputSchema>;

export const conferenceEventPatchSchema = eventFields
  .partial()
  .superRefine(checkWindow)
  .refine((p) => Object.values(p).some((v) => v !== undefined), 'Change at least one field');
export type ConferenceEventPatch = z.infer<typeof conferenceEventPatchSchema>;

export const availabilitySchema = z
  .object({
    ranges: z.array(z.object({ start: hhmm, end: hhmm })).min(1, 'Add at least one time range').max(MAX_RANGES),
    location: z.string().trim().max(LOCATION_MAX).optional(),
  })
  .superRefine((a, ctx) => {
    a.ranges.forEach((r, i) => {
      if (r.end <= r.start) ctx.addIssue({ code: 'custom', path: ['ranges', i, 'end'], message: 'End must be after start' });
    });
    const sorted = [...a.ranges].sort((x, y) => x.start.localeCompare(y.start));
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].start < sorted[i - 1].end) {
        ctx.addIssue({ code: 'custom', path: ['ranges'], message: 'Time ranges must not overlap' });
        break;
      }
    }
  });
export type AvailabilityInput = z.infer<typeof availabilitySchema>;

export const slotPatchSchema = z
  .object({
    blocked: z.boolean().optional(),
    location: z.string().trim().max(LOCATION_MAX).nullable().optional(),
  })
  .refine((p) => p.blocked !== undefined || p.location !== undefined, 'Change at least one field');
export type SlotPatch = z.infer<typeof slotPatchSchema>;

export const bookingSchema = z.object({
  studentId: z.string().min(1),
  parentNote: z.string().trim().max(PARENT_NOTE_MAX, `Note must be ${PARENT_NOTE_MAX} characters or fewer`).optional(),
});
export type BookingInput = z.infer<typeof bookingSchema>;

export const conferenceListQuery = z.object({
  ...listParams,
  sort: sortParam(['date', 'title'], 'date:desc'),
  upcoming: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
});
export type ConferenceListQuery = z.infer<typeof conferenceListQuery>;

export const slotsQuery = z.object({
  studentId: z.string().min(1).optional(),
  teacherId: z.string().min(1).optional(),
  view: z.literal('day').optional(),
});
export type SlotsQuery = z.infer<typeof slotsQuery>;
