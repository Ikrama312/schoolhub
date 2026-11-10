import { z } from 'zod';
import { dateOnly } from './attendance';

/**
 * PRD-15 absence notes (FR-2, FR-18, FR-22, NFR-7). Client-safe; shared by the
 * parent form and the handlers. The −14/+60 day window depends on the school-tz
 * "today", so it is a factory: the form passes the browser's view of today, the
 * service re-checks with schoolToday().
 */

export const ABSENCE_REASONS = ['ILLNESS', 'MEDICAL_APPOINTMENT', 'FAMILY', 'RELIGIOUS', 'OTHER'] as const;
export const ABSENCE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export const REVIEW_DECISIONS = ['APPROVED', 'REJECTED'] as const;

export const ABSENCE_REASON_LABELS: Record<(typeof ABSENCE_REASONS)[number], string> = {
  ILLNESS: 'Illness',
  MEDICAL_APPOINTMENT: 'Medical appointment',
  FAMILY: 'Family reasons',
  RELIGIOUS: 'Religious observance',
  OTHER: 'Other',
};

export const DETAILS_MAX = 1000;
export const REVIEW_NOTE_MAX = 1000;
export const MAX_SPAN_DAYS = 30;
export const PAST_DAYS = 14;
export const FUTURE_DAYS = 60;

const DAY_MS = 86_400_000;
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

const fields = z.object({
  studentId: z.string().min(1),
  fromDate: dateOnly,
  toDate: dateOnly,
  partialDay: z.boolean().default(false),
  periodIds: z.array(z.string().min(1)).max(20).default([]),
  reason: z.enum(ABSENCE_REASONS),
  details: z.string().trim().max(DETAILS_MAX, `Details must be ${DETAILS_MAX} characters or fewer`).optional(),
  fileId: z.string().min(1).optional(),
});

type Fields = z.infer<typeof fields>;

function checkShape(n: Fields, ctx: z.RefinementCtx) {
  if (n.toDate < n.fromDate) ctx.addIssue({ code: 'custom', path: ['toDate'], message: 'To date must be on or after the from date' });
  else if (days(n.fromDate, n.toDate) > MAX_SPAN_DAYS) {
    ctx.addIssue({ code: 'custom', path: ['toDate'], message: `A note can cover at most ${MAX_SPAN_DAYS} days` });
  }
  if (n.partialDay && n.periodIds.length === 0) ctx.addIssue({ code: 'custom', path: ['periodIds'], message: 'Choose at least one period' });
  if (!n.partialDay && n.periodIds.length > 0) ctx.addIssue({ code: 'custom', path: ['periodIds'], message: 'Periods are only used for part-day absences' });
}

/** Structural rules only (FR-2). */
export const absenceNoteInputSchema = fields.superRefine(checkShape);
export type AbsenceNoteInput = z.infer<typeof absenceNoteInputSchema>;
export type AbsenceNoteFormValues = z.input<typeof absenceNoteInputSchema>;

/** FR-18: the date window relative to the school-tz `today`. */
export function dateWindowIssue(n: { fromDate: string; toDate: string }, today: string): { path: string; message: string } | null {
  if (days(n.fromDate, today) > PAST_DAYS) return { path: 'fromDate', message: `From date can be at most ${PAST_DAYS} days ago` };
  if (days(today, n.toDate) > FUTURE_DAYS) return { path: 'toDate', message: `To date can be at most ${FUTURE_DAYS} days ahead` };
  return null;
}

export function absenceNoteSchemaFor(today: string) {
  return fields.superRefine((n, ctx) => {
    checkShape(n, ctx);
    const issue = dateWindowIssue(n, today);
    if (issue) ctx.addIssue({ code: 'custom', path: [issue.path], message: issue.message });
  });
}

export const reviewSchema = z
  .object({
    decision: z.enum(REVIEW_DECISIONS),
    reviewNote: z.string().trim().max(REVIEW_NOTE_MAX, `Note must be ${REVIEW_NOTE_MAX} characters or fewer`).optional(),
  })
  .superRefine((r, ctx) => {
    if (r.decision === 'REJECTED' && !r.reviewNote) ctx.addIssue({ code: 'custom', path: ['reviewNote'], message: 'A note is required when rejecting' });
  });
export type ReviewInput = z.infer<typeof reviewSchema>;

const sortParam = (fields: readonly string[], fallback: string) =>
  z
    .string()
    .regex(new RegExp(`^(${fields.join('|')}):(asc|desc)$`), 'Invalid sort')
    .default(fallback)
    .transform((s) => {
      const [field, dir] = s.split(':');
      return { field, dir: dir as 'asc' | 'desc' };
    });

/** Shared list params (NFR-10). page/pageSize are read by parsePagination; accepted here so parseQuery doesn't choke. */
export const listParams = {
  page: z.string().optional(),
  pageSize: z.string().optional(),
  q: z.string().trim().max(100).optional(),
};
export { sortParam };

export const absenceNoteListQuery = z
  .object({
    ...listParams,
    status: z.enum(ABSENCE_STATUSES).optional(),
    studentId: z.string().min(1).optional(),
    from: dateOnly.optional(),
    to: dateOnly.optional(),
    sort: sortParam(['createdAt', 'fromDate'], 'createdAt:desc'),
  })
  .refine((q) => !q.from || !q.to || q.to >= q.from, { message: '`to` must be on or after `from`', path: ['to'] });
export type AbsenceNoteListQuery = z.infer<typeof absenceNoteListQuery>;
