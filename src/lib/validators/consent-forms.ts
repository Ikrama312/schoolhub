import { z } from 'zod';
import { listParams, sortParam } from './absence-notes';

/** PRD-15 consent forms (FR-36 to FR-39, NFR-7). Client-safe. */

export const CONSENT_AUDIENCE_TYPES = ['GRADE_LEVEL', 'SECTION', 'COURSE'] as const;
export const CONSENT_VALUES = ['GRANTED', 'DECLINED'] as const;
export const TRACKING_STATUSES = ['GRANTED', 'DECLINED', 'NO_RESPONSE'] as const;
export type TrackingStatus = (typeof TRACKING_STATUSES)[number];

export const CONSENT_DESCRIPTION_MAX = 10_000;
export const CONSENT_COMMENT_MAX = 1000;

export const consentAudienceSchema = z.object({ type: z.enum(CONSENT_AUDIENCE_TYPES), refId: z.string().min(1, 'Choose who this is for') });

export const consentFormInputSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().trim().min(1, 'Description is required').max(CONSENT_DESCRIPTION_MAX),
  dueAt: z
    .string()
    .datetime({ offset: true })
    .refine((d) => Date.parse(d) > Date.now(), 'Due date must be in the future'),
  eventId: z.string().min(1).nullable().optional().transform((v) => v ?? null),
  audiences: z.array(consentAudienceSchema).min(1, 'Add at least one audience').max(20),
});
export type ConsentFormInput = z.infer<typeof consentFormInputSchema>;
export type ConsentFormValues = z.input<typeof consentFormInputSchema>;

export const consentResponseSchema = z.object({
  studentId: z.string().min(1),
  value: z.enum(CONSENT_VALUES),
  signature: z.string().trim().min(1, 'Type your full name to sign').max(200),
  comment: z.string().trim().max(CONSENT_COMMENT_MAX).optional(),
});
export type ConsentResponseInput = z.infer<typeof consentResponseSchema>;

export const consentListQuery = z.object({
  ...listParams,
  pending: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  studentId: z.string().min(1).optional(),
  sort: sortParam(['dueAt', 'createdAt'], 'dueAt:asc'),
});
export type ConsentListQuery = z.infer<typeof consentListQuery>;

export const trackingQuery = z.object({
  ...listParams,
  status: z.enum(TRACKING_STATUSES).optional(),
  format: z.literal('csv').optional(),
  sort: sortParam(['studentName', 'status', 'respondedAt'], 'studentName:asc'),
});
export type TrackingQuery = z.infer<typeof trackingQuery>;
