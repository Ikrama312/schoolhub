import { z } from 'zod';
import { BODY_MAX, MAX_FILES, MAX_PARTICIPANTS, PAGE_SIZE, REASON_MAX, SUBJECT_MAX } from '@/lib/messaging/constants';

/** PRD-13 validation (system-design §3.2). Client-safe: shared by the composer/dialogs and every handler. */

const id = z.string().min(1);
const body = z.string().trim().min(1, 'Message is required').max(BODY_MAX, `At most ${BODY_MAX} characters`);
const fileIds = z.array(id).max(MAX_FILES, `At most ${MAX_FILES} attachments`).optional();
/** Query-string boolean: only 'true'/'false' (z.coerce.boolean would read 'false' as true). */
const queryBool = z.enum(['true', 'false']).transform((v) => v === 'true');
const page = z.coerce.number().int().min(1).optional();
const pageSize = z.coerce.number().int().min(1).max(100).optional();

export const createConversationSchema = z.object({
  participantIds: z
    .array(id)
    .min(1, 'Pick at least one recipient')
    .max(MAX_PARTICIPANTS - 1, `At most ${MAX_PARTICIPANTS - 1} recipients`)
    .transform((ids) => [...new Set(ids)]),
  subject: z.string().trim().max(SUBJECT_MAX, `At most ${SUBJECT_MAX} characters`).optional().transform((s) => s || undefined),
  body,
  fileIds,
});
export type CreateConversationInput = z.output<typeof createConversationSchema>;

export const sendMessageSchema = z.object({ body, fileIds });
export type SendMessageInput = z.output<typeof sendMessageSchema>;

export const editMessageSchema = z.object({ body });

export const listMessagesQuery = z
  .object({
    before: id.optional(),
    after: id.optional(),
    since: z.string().datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(PAGE_SIZE).default(PAGE_SIZE),
  })
  .refine((q) => !(q.before && q.after), { message: 'before and after are mutually exclusive', path: ['before'] })
  .refine((q) => !q.since || q.after, { message: 'since requires after', path: ['since'] });
export type ListMessagesQuery = z.output<typeof listMessagesQuery>;

export const listConversationsQuery = z.object({
  archived: queryBool.optional(),
  q: z.string().trim().max(100).optional(),
  page,
  pageSize,
});

export const archiveSchema = z.object({ archived: z.boolean() });
export const muteSchema = z.object({ muted: z.boolean() });

export const reportSchema = z.object({
  reason: z.string().trim().min(1, 'Reason is required').max(REASON_MAX, `At most ${REASON_MAX} characters`),
});

export const reviewReportSchema = z
  .object({
    action: z.enum(['review', 'dismiss']),
    note: z.string().trim().max(REASON_MAX, `At most ${REASON_MAX} characters`).optional(),
  })
  .refine((v) => v.action !== 'review' || !!v.note, { message: 'A note is required to mark reviewed', path: ['note'] });

export const reportsQuery = z.object({ status: z.enum(['OPEN', 'REVIEWED', 'DISMISSED']).optional(), page, pageSize });

export const safeguardingConversationsQuery = z.object({
  participantId: id.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page,
  pageSize,
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');
export const messagingSettingsSchema = z
  .object({ quietStart: hhmm.nullable(), quietEnd: hhmm.nullable() })
  .refine((s) => (s.quietStart === null) === (s.quietEnd === null), { message: 'Set both start and end, or neither', path: ['quietEnd'] })
  .refine((s) => s.quietStart === null || s.quietStart !== s.quietEnd, { message: 'Start and end must differ', path: ['quietEnd'] });
export type MessagingSettingsInput = z.output<typeof messagingSettingsSchema>;

export const contactsQuery = z.object({ q: z.string().trim().max(100).optional() });
