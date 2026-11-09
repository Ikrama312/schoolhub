import { z } from 'zod';

/**
 * Course/enrollment validation (PRD-05 FR-14/FR-23), shared by the
 * /admin/courses dialog and the /api/courses* handlers. The
 * "section required iff CORE" rule is ONE refinement here (Decision 3).
 */

export const COURSE_KINDS = ['CORE', 'ELECTIVE'] as const;
export const ENROLLMENT_STATUSES = ['ACTIVE', 'DROPPED'] as const;

const nullableText = z.preprocess((v) => (v === '' ? null : v), z.string().nullable().optional());
const nullableId = z.preprocess((v) => (v === '' ? null : v), z.string().min(1).nullable().optional());

export const courseCodeSchema = z
  .string()
  .trim()
  .min(1, 'Code is required')
  .max(30)
  .transform((v) => v.toUpperCase());

const courseCapacitySchema = z.preprocess(
  (v) => (v === '' || v === undefined ? null : v),
  z.coerce.number().int('Capacity must be a whole number').min(1, 'Capacity must be at least 1').nullable(),
);

const coTeacherIdsSchema = z.array(z.string().min(1)).max(3, 'At most 3 co-teachers').default([]);

const courseBase = z.object({
  academicYearId: z.string().min(1, 'Academic year is required'),
  subjectId: z.string().min(1, 'Subject is required'),
  sectionId: nullableId,
  teacherId: z.string().min(1, 'Teacher is required'),
  coTeacherIds: coTeacherIdsSchema,
  name: z.string().trim().min(1, 'Name is required').max(120),
  code: courseCodeSchema,
  kind: z.enum(COURSE_KINDS).default('CORE'),
  capacity: courseCapacitySchema.optional(),
  description: nullableText,
});

export const courseInputSchema = courseBase.refine((v) => v.kind !== 'CORE' || Boolean(v.sectionId), {
  message: 'Section is required for core courses',
  path: ['sectionId'],
});
export type CourseInput = z.infer<typeof courseInputSchema>;

/** academicYearId/sectionId/kind are immutable after creation. */
export const courseUpdateSchema = courseBase
  .omit({ academicYearId: true, sectionId: true, kind: true })
  .extend({ coTeacherIds: z.array(z.string().min(1)).max(3, 'At most 3 co-teachers'), archived: z.boolean() })
  .partial();
export type CourseUpdateInput = z.infer<typeof courseUpdateSchema>;

export const enrollmentStatusSchema = z.object({
  status: z.enum(ENROLLMENT_STATUSES),
  overrideCapacity: z.boolean().optional().default(false),
});
export type EnrollmentStatusInput = z.infer<typeof enrollmentStatusSchema>;

const boolFlag = z.enum(['true', 'false']).optional().transform((v) => v === 'true');

export const coursesListQuerySchema = z.object({
  academicYearId: z.string().optional(),
  gradeLevelId: z.string().optional(),
  subjectId: z.string().optional(),
  teacherId: z.string().optional(),
  sectionId: z.string().optional(),
  kind: z.enum(COURSE_KINDS).optional(),
  includeArchived: boolFlag,
  q: z.string().optional(),
  sort: z.enum(['code', 'name', 'enrolledCount']).optional().default('code'),
  order: z.enum(['asc', 'desc']).optional().default('asc'),
});
export type CoursesListQuery = z.infer<typeof coursesListQuerySchema>;

export const rosterQuerySchema = z.object({
  status: z.enum(['ACTIVE', 'DROPPED', 'ALL']).optional().default('ACTIVE'),
  q: z.string().optional(),
});
export type RosterQuery = z.infer<typeof rosterQuerySchema>;

/** FR-14 defaults: "<Subject> – <Section>" / "<SUBJECTCODE>-<SECTION>". */
export function defaultCourseName(subjectName: string, sectionName?: string | null): string {
  return sectionName ? `${subjectName} – ${sectionName}` : subjectName;
}

export function defaultCourseCode(subjectCode: string, sectionName?: string | null): string {
  const base = subjectCode.trim().toUpperCase();
  return sectionName ? `${base}-${sectionName.trim().toUpperCase().replace(/\s+/g, '')}` : base;
}
