import { z } from 'zod';
import { dec, fixed2 } from '@/server/assignments/grading-math';

/**
 * PRD-11 validation (FR-16, FR-17, FR-22, FR-23, FR-39, FR-40). Client-safe: shared by the
 * gradebook/report-card forms and every handler. Decimals come in as number | string and leave
 * as "18.00" (fixed2, NFR-1). gpa is stored only, never computed (NFR-13).
 */

export const COMMENT_MAX = 1000;

const id = z.string().min(1);

/**
 * number | "12.5" within [min, max], at most 2 dp → "12.50". One short-circuiting superRefine:
 * zod runs chained refines after a failure and dec() throws on non-numeric input.
 */
const decimal = (min: number, max: number, label: string, { exclusiveMin = false } = {}) =>
  z
    .union([z.number(), z.string().trim().min(1, `${label} is required`)])
    .superRefine((v, ctx) => {
      const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
      if (!/^\d+(\.\d{1,2})?$/.test(String(v))) return fail(`${label} must be a number with at most 2 decimals`);
      const d = dec(v);
      if ((exclusiveMin ? d.lte(min) : d.lt(min)) || d.gt(max)) {
        return fail(exclusiveMin ? `${label} must be greater than ${min} and at most ${max}` : `${label} must be between ${min} and ${max}`);
      }
    })
    .transform((v) => fixed2(v));

const comment = z.string().max(COMMENT_MAX, `At most ${COMMENT_MAX} characters`);
const nullableComment = comment.nullable();
const instant = z.coerce.date({ invalid_type_error: 'Enter a valid date and time' });

// ---------------------------------------------------------------------------
// Grading scales (FR-16)
// ---------------------------------------------------------------------------

export const bandSchema = z.object({
  letter: z.string().trim().min(1, 'Letter is required').max(5, 'At most 5 characters'),
  minPercent: z.coerce.number({ invalid_type_error: 'Enter a number' }).min(0, 'At least 0').max(100, 'At most 100'),
  gpa: z.coerce.number({ invalid_type_error: 'Enter a number' }).min(0).max(10).optional(),
  descriptor: z.string().trim().max(100).optional(),
});
export type Band = z.output<typeof bandSchema>;

/** Strictly descending minPercent, last band 0, unique letters. Out-of-order input is an error, never re-sorted. */
export const bandsSchema = z
  .array(bandSchema)
  .min(1, 'Add at least one band')
  .max(30)
  .superRefine((bands, ctx) => {
    bands.forEach((b, i) => {
      if (i > 0 && !(b.minPercent < bands[i - 1].minPercent)) {
        ctx.addIssue({ code: 'custom', path: [i, 'minPercent'], message: 'Must be lower than the band above' });
      }
      if (bands.findIndex((x) => x.letter === b.letter) !== i) {
        ctx.addIssue({ code: 'custom', path: [i, 'letter'], message: 'Letters must be unique' });
      }
    });
    if (bands.length && bands[bands.length - 1].minPercent !== 0) {
      ctx.addIssue({ code: 'custom', path: [bands.length - 1, 'minPercent'], message: 'The lowest band must start at 0' });
    }
  });

export const scaleSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  isDefault: z.boolean().default(false),
  bands: bandsSchema,
});
export type ScaleInput = z.output<typeof scaleSchema>;
export type ScaleFormValues = z.input<typeof scaleSchema>;

export const scalePatchSchema = z
  .object({ name: scaleSchema.shape.name, isDefault: z.boolean(), bands: bandsSchema })
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to update');
export type ScalePatch = z.output<typeof scalePatchSchema>;

// ---------------------------------------------------------------------------
// Categories (FR-17, FR-40)
// ---------------------------------------------------------------------------

export const categoryInput = z.object({
  id: id.optional(),
  name: z.string().trim().min(1, 'Name is required').max(60),
  weightPercent: decimal(0, 100, 'Weight'),
  dropLowest: z.coerce.number().int().min(0).max(50).default(0),
  order: z.coerce.number().int().min(0),
});

/** Σ weights as a 2 dp string, for the live "90 / 100" chip and the service check. */
export function weightSum(categories: readonly { weightPercent: string | number }[]): string {
  return fixed2(categories.reduce((s, c) => s.plus(dec(/^\d+(\.\d+)?$/.test(String(c.weightPercent)) ? c.weightPercent : 0)), dec(0)));
}

export const categoriesPutSchema = z
  .object({
    categories: z.array(categoryInput).max(20),
    gradingScaleId: id.nullable().optional(),
  })
  .superRefine((v, ctx) => {
    const names = v.categories.map((c) => c.name.toLowerCase());
    names.forEach((n, i) => {
      if (names.indexOf(n) !== i) ctx.addIssue({ code: 'custom', path: ['categories', i, 'name'], message: 'Names must be unique' });
    });
  });
export type CategoriesPut = z.output<typeof categoriesPutSchema>;

// ---------------------------------------------------------------------------
// Items, grades, overrides (FR-9, FR-20, FR-22, FR-23)
// ---------------------------------------------------------------------------

export const manualItemSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  categoryId: id.nullable().optional(),
  maxPoints: decimal(0, 1000, 'Max points', { exclusiveMin: true }),
  dueAt: instant.nullable().optional(),
  termId: id,
});
export type ManualItemInput = z.output<typeof manualItemSchema>;
export type ManualItemFormValues = z.input<typeof manualItemSchema>;

export const itemPatchSchema = manualItemSchema
  .partial()
  .extend({ isVisible: z.boolean().optional() })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to update');
export type ItemPatch = z.output<typeof itemPatchSchema>;

export const gradePutSchema = z
  .object({
    score: decimal(0, 1000, 'Score').nullable(),
    excused: z.boolean(),
    missing: z.boolean(),
    comment: nullableComment,
  })
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to update');
export type GradePut = z.output<typeof gradePutSchema>;

export const termOverrideSchema = z.object({
  termId: id,
  percent: decimal(0, 100, 'Percent').nullable().optional(),
  letter: z.string().trim().max(5).nullable().optional(),
  teacherComment: nullableComment.optional(),
});
export type TermOverrideInput = z.output<typeof termOverrideSchema>;
export type TermOverrideFormValues = z.input<typeof termOverrideSchema>;

export const gradebookQuery = z.object({ termId: id.optional(), format: z.enum(['json', 'csv']).default('json') });
export const studentGradesQuery = z.object({ termId: id.optional(), courseId: id.optional() });

// ---------------------------------------------------------------------------
// Report cards (FR-29..FR-34)
// ---------------------------------------------------------------------------

export const reportCardPatchSchema = z
  .object({ homeroomComment: nullableComment, principalComment: nullableComment })
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to update');
export type ReportCardPatch = z.output<typeof reportCardPatchSchema>;

const idList = z
  .array(id)
  .min(1, 'Select at least one')
  .max(2000)
  .refine((ids) => new Set(ids).size === ids.length, 'Ids must be unique');

export const generateSchema = z.object({ termId: id, studentIds: idList });
export const publishSchema = z.object({ ids: idList });
export const unpublishSchema = z.object({ ids: idList, reason: z.string().trim().min(1, 'A reason is required').max(500) });

export const reportCardsQuery = z.object({
  termId: id.optional(),
  gradeLevelId: id.optional(),
  sectionId: id.optional(),
  studentId: id.optional(),
});
