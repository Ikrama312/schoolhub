import { z } from 'zod';
import { dec, fixed2, rubricTotal } from '@/server/assignments/grading-math';

/**
 * PRD-09 validation (FR-7, system-design §2.6). Shared by the forms and every assignment handler.
 * Decimals come in as number | string and leave as a 2 dp string ("14.40", NFR-1). No schema
 * carries a client "now" (NFR-2): rules that need the clock (SCHEDULED in the future, deadlines)
 * live in the service.
 */

export const SUBMISSION_TYPES = ['ONLINE_TEXT', 'FILE_UPLOAD', 'TEXT_AND_FILE', 'NO_SUBMISSION'] as const;
export const ASSIGNMENT_STATUSES = ['DRAFT', 'SCHEDULED', 'PUBLISHED'] as const;
export const CHIP_STATUSES = ['NOT_SUBMITTED', 'SUBMITTED', 'LATE', 'GRADED', 'RETURNED', 'EXEMPT'] as const;
export const STUDENT_TABS = ['UPCOMING', 'MISSING', 'SUBMITTED', 'RETURNED'] as const;

export const TITLE_MAX = 150;
export const INSTRUCTIONS_MAX = 50_000;
export const SUBMISSION_TEXT_MAX = 50_000;
export const FEEDBACK_MAX = 10_000;

const id = z.string().min(1);

/** number | "12.5" within [min, max], at most 2 dp → "12.50". */
const decimal = (min: number, max: number, label: string) =>
  z
    .union([z.number(), z.string().trim().min(1, `${label} is required`)])
    .refine((v) => /^-?\d+(\.\d{1,2})?$/.test(String(v)), `${label} must be a number with at most 2 decimals`)
    .refine((v) => {
      const d = dec(v);
      return d.gte(min) && d.lte(max);
    }, `${label} must be between ${min} and ${max}`)
    .transform((v) => fixed2(v));

const instant = z.coerce.date({ invalid_type_error: 'Enter a valid date and time' });

export const rubricLevelInput = z.object({
  label: z.string().trim().min(1, 'Level label is required').max(100),
  points: decimal(0, 1000, 'Level points'),
  description: z.string().trim().max(1000).optional().default(''),
});

export const rubricCriterionInput = z
  .object({
    id: id.optional(),
    title: z.string().trim().min(1, 'Criterion title is required').max(TITLE_MAX),
    description: z.string().trim().max(1000).optional().default(''),
    maxPoints: decimal(0, 1000, 'Criterion points'),
    levels: z.array(rubricLevelInput).min(1, 'Add at least one level').max(10),
  })
  .superRefine((c, ctx) => {
    c.levels.forEach((l, i) => {
      if (dec(l.points).gt(dec(c.maxPoints))) {
        ctx.addIssue({ code: 'custom', path: ['levels', i, 'points'], message: 'Level points exceed the criterion maximum' });
      }
    });
  });

export const rubricSumMessage = (sum: string, maxPoints: string) =>
  `Rubric totals ${sum} points but the assignment is worth ${maxPoints}.`;

const trimZeros = (s: string) => dec(s).toString();

export const assignmentFields = z.object({
  title: z.string().trim().min(1, 'Title is required').max(TITLE_MAX),
  instructions: z.string().max(INSTRUCTIONS_MAX).default(''),
  submissionType: z.enum(SUBMISSION_TYPES),
  maxPoints: decimal(0, 1000, 'Max points'),
  dueAt: instant,
  availableFrom: instant.nullable().optional(),
  allowLate: z.boolean().default(false),
  lateCutoffAt: instant.nullable().optional(),
  latePenaltyPercentPerDay: decimal(0, 100, 'Penalty per day').default(0),
  maxLatePenaltyPercent: decimal(0, 100, 'Maximum penalty').default(0),
  maxFileCount: z.coerce.number().int().min(1).max(10).default(3),
  allowExtraCredit: z.boolean().default(false),
  status: z.enum(ASSIGNMENT_STATUSES),
  rubric: z.array(rubricCriterionInput).max(20).nullable().optional(),
  attachmentFileIds: z.array(id).max(10).default([]),
  /** PRD-11 FR-2: gradebook category; null = Uncategorised. */
  categoryId: id.nullable().optional(),
});

type AssignmentShape = z.output<typeof assignmentFields>;

/** FR-7 lateCutoffAt > dueAt; FR-11 rubric Σ = maxPoints. Applied to create and to the merged PATCH result. */
export function assignmentRules(val: Partial<AssignmentShape>, ctx: z.RefinementCtx) {
  if (val.lateCutoffAt && val.dueAt && val.lateCutoffAt.getTime() <= val.dueAt.getTime()) {
    ctx.addIssue({ code: 'custom', path: ['lateCutoffAt'], message: 'The late cutoff must be after the due date' });
  }
  if (val.status === 'SCHEDULED' && !val.availableFrom) {
    ctx.addIssue({ code: 'custom', path: ['availableFrom'], message: 'Choose when the assignment becomes available' });
  }
  if (val.rubric && val.rubric.length > 0 && val.maxPoints !== undefined) {
    const sum = rubricTotal(val.rubric);
    if (!sum.eq(dec(val.maxPoints))) {
      ctx.addIssue({ code: 'custom', path: ['rubric'], message: rubricSumMessage(sum.toString(), trimZeros(val.maxPoints)) });
    }
  }
}

export const assignmentInput = assignmentFields.superRefine(assignmentRules);
export const assignmentPatch = assignmentFields.partial();
export type AssignmentInput = z.output<typeof assignmentInput>;
export type AssignmentFormValues = z.input<typeof assignmentInput>;
export type AssignmentPatch = z.output<typeof assignmentPatch>;
export type RubricCriterionValues = z.output<typeof rubricCriterionInput>;

export const submissionInput = z.object({
  text: z.string().max(SUBMISSION_TEXT_MAX).optional(),
  fileIds: z.array(id).max(10).default([]),
});

export const rubricScoreInput = z.object({
  criterionId: id,
  points: decimal(0, 1000, 'Points'),
  comment: z.string().max(2000).optional(),
});

const gradeFields = {
  rawScore: decimal(0, 1200, 'Raw score').optional(),
  feedback: z.string().max(FEEDBACK_MAX).optional(),
  rubricScores: z.array(rubricScoreInput).max(20).optional(),
  return: z.boolean().default(false),
};

export const gradeInput = z.object({ ...gradeFields, penaltyPercent: decimal(0, 100, 'Penalty') });
export const offlineGradeInput = z.object({ ...gradeFields, studentId: id });
export type GradeInput = z.output<typeof gradeInput>;
export type OfflineGradeInput = z.output<typeof offlineGradeInput>;

export const bulkReturnInput = z.object({ submissionIds: z.array(id).max(500).optional() });
export const duplicateInput = z.object({ courseIds: z.array(id).min(1, 'Choose at least one course').max(50) });
export const exemptionInput = z.object({ reason: z.string().trim().max(500).optional() });

export const meAssignmentsQuery = z.object({
  studentId: id.optional(),
  tab: z.enum(STUDENT_TABS).optional(),
  courseId: id.optional(),
});

export const studentQuery = z.object({ studentId: id.optional() });

export const rosterQuery = z.object({
  sort: z.enum(['name', 'submittedAt']).default('name'),
  status: z.enum(CHIP_STATUSES).optional(),
});
