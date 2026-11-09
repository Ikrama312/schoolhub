import { z } from 'zod';
import { parseVideoUrl } from '@/lib/video';

/**
 * PRD-08 content validation (FR-16, FR-23, FR-27, FR-28). Shared by the
 * lesson editor and every content handler. Access rules live in the service.
 */

export const CONTENT_STATUSES = ['DRAFT', 'SCHEDULED', 'PUBLISHED'] as const;
export const contentStatus = z.enum(CONTENT_STATUSES);

export const MODULE_TITLE_MAX = 120;
export const LESSON_TITLE_MAX = 150;
export const MARKDOWN_MAX = 100_000;

const id = z.string().min(1);
const publishAt = z.coerce.date().nullable().optional();

const httpUrl = z
  .string()
  .trim()
  .url('Enter a valid URL')
  .refine((u) => /^https?:\/\//i.test(u), 'Only http(s) links are allowed');

const videoUrl = z
  .string()
  .trim()
  .refine((u) => u === '' || parseVideoUrl(u) !== null, 'Only YouTube or Vimeo URLs are supported')
  .transform((u) => (u === '' ? null : u))
  .nullable()
  .optional();

/** FR-28: SCHEDULED needs a future publishAt. Applied to every schema with status. */
function scheduleRule(val: { status?: string; publishAt?: Date | null }, ctx: z.RefinementCtx) {
  if (val.status !== 'SCHEDULED') return;
  if (!val.publishAt) {
    ctx.addIssue({ code: 'custom', path: ['publishAt'], message: 'Choose a date and time to schedule' });
  } else if (val.publishAt.getTime() <= Date.now()) {
    ctx.addIssue({ code: 'custom', path: ['publishAt'], message: 'The scheduled time must be in the future' });
  }
}

const moduleFields = {
  title: z.string().trim().min(1, 'Title is required').max(MODULE_TITLE_MAX),
  description: z.string().trim().max(2000).nullable().optional(),
  status: contentStatus.optional(),
  publishAt,
};

export const moduleCreate = z.object(moduleFields).strict().superRefine(scheduleRule);
export const moduleUpdate = z.object(moduleFields).partial().strict().superRefine(scheduleRule);

const lessonFields = {
  title: z.string().trim().min(1, 'Title is required').max(LESSON_TITLE_MAX),
  contentMarkdown: z.string().max(MARKDOWN_MAX),
  estimatedMinutes: z.number().int().min(1).max(600).nullable(),
  videoUrl,
  attachments: z.array(z.object({ fileId: id }).strict()).max(50),
  links: z
    .array(z.object({ title: z.string().trim().min(1).max(200), url: httpUrl }).strict())
    .max(50),
  status: contentStatus,
  publishAt,
};

export const lessonCreate = z
  .object({ title: lessonFields.title })
  .strict();
export const lessonUpdate = z.object(lessonFields).partial().strict().superRefine(scheduleRule);

/** FR-23: the full ordering of the course. */
export const reorderSchema = z
  .object({ modules: z.array(z.object({ id, lessonIds: z.array(id) }).strict()) })
  .strict();

export const progressSchema = z.object({ completed: z.boolean() }).strict();

export type ModuleCreateInput = z.infer<typeof moduleCreate>;
export type ModuleUpdateInput = z.infer<typeof moduleUpdate>;
export type LessonCreateInput = z.infer<typeof lessonCreate>;
export type LessonUpdateInput = z.infer<typeof lessonUpdate>;
export type ReorderInput = z.infer<typeof reorderSchema>;
