import { z } from 'zod';

/**
 * Section validation (PRD-05 FR-3/FR-23), shared by the /admin/sections
 * dialogs and the /api/sections* handlers.
 */

const optionalId = z.preprocess((v) => (v === '' ? null : v), z.string().min(1).nullable().optional());

export const sectionCapacitySchema = z.coerce
  .number()
  .int('Capacity must be a whole number')
  .min(1, 'Capacity must be at least 1')
  .max(60, 'Capacity must be at most 60');

export const sectionInputSchema = z.object({
  academicYearId: z.string().min(1, 'Academic year is required'),
  gradeLevelId: z.string().min(1, 'Grade level is required'),
  name: z.string().trim().min(1, 'Name is required').max(40),
  homeroomTeacherId: optionalId,
  roomId: optionalId,
  capacity: sectionCapacitySchema.default(30),
});
export type SectionInput = z.infer<typeof sectionInputSchema>;

/** academicYearId is immutable after creation. */
export const sectionUpdateSchema = sectionInputSchema.omit({ academicYearId: true }).partial();
export type SectionUpdateInput = z.infer<typeof sectionUpdateSchema>;

export const enrollStudentsSchema = z.object({
  studentIds: z.array(z.string().min(1)).min(1, 'Pick at least one student'),
  overrideCapacity: z.boolean().optional().default(false),
});
export type EnrollStudentsInput = z.infer<typeof enrollStudentsSchema>;

export const moveSectionSchema = z.object({
  toSectionId: z.string().min(1, 'Destination section is required'),
  overrideCapacity: z.boolean().optional().default(false),
});
export type MoveSectionInput = z.infer<typeof moveSectionSchema>;

export const coreCoursesSchema = z.object({
  items: z
    .array(z.object({ subjectId: z.string().min(1), teacherId: z.string().min(1, 'Teacher is required') }))
    .min(1, 'Pick at least one subject')
    .refine((items) => new Set(items.map((i) => i.subjectId)).size === items.length, {
      message: 'Each subject may appear only once',
    }),
});
export type CoreCoursesInput = z.infer<typeof coreCoursesSchema>;

export const copyToYearSchema = z
  .object({ fromYearId: z.string().min(1), toYearId: z.string().min(1) })
  .refine((v) => v.fromYearId !== v.toYearId, { message: 'Target year must differ', path: ['toYearId'] });
export type CopyToYearInput = z.infer<typeof copyToYearSchema>;

export const sectionsListQuerySchema = z.object({
  academicYearId: z.string().optional(),
  gradeLevelId: z.string().optional(),
  q: z.string().optional(),
  sort: z.enum(['name', 'gradeLevel', 'memberCount']).optional().default('gradeLevel'),
  order: z.enum(['asc', 'desc']).optional().default('asc'),
});
export type SectionsListQuery = z.infer<typeof sectionsListQuerySchema>;
