import { z } from 'zod';
import { dateOnly } from './attendance';

/** PRD-16 reports centre (FR-33–FR-39, FR-44). The registry in src/server/reports/index.ts uses these. */

export const REPORT_KEYS = ['enrollment', 'attendance', 'performance', 'completion', 'engagement', 'workload'] as const;
export const reportKey = z.enum(REPORT_KEYS);
export type ReportKey = z.infer<typeof reportKey>;

const id = z.string().min(1);
const opt = <T extends z.ZodTypeAny>(schema: T) => z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

/** Shared by every report: year/term selector (default current) + CSV switch. */
export const reportSelector = z.object({
  academicYearId: opt(id),
  termId: opt(id),
  format: z.enum(['json', 'csv']).default('json'),
});

const fromBeforeTo = <T extends { from?: string; to?: string }>(f: T) => !f.from || !f.to || f.from <= f.to;
const rangeIssue = { message: '`from` must be on or before `to`', path: ['to'] };

export const enrollmentFilters = reportSelector
  .extend({ gradeLevel: opt(id), sectionId: opt(id), from: opt(dateOnly), to: opt(dateOnly) })
  .refine(fromBeforeTo, rangeIssue);

/** from/to are optional here; the report defaults them to the selected term (or the last 30 days). */
export const attendanceFilters = reportSelector
  .extend({
    from: opt(dateOnly),
    to: opt(dateOnly),
    groupBy: z.enum(['gradeLevel', 'section', 'course']).default('gradeLevel'),
    gradeLevel: opt(id),
    sectionId: opt(id),
  })
  .refine(fromBeforeTo, rangeIssue);

export const performanceFilters = reportSelector.extend({
  groupBy: z.enum(['course', 'subject']).default('course'),
  gradeLevel: opt(id),
  subjectId: opt(id),
});

export const completionFilters = reportSelector
  .extend({ from: opt(dateOnly), to: opt(dateOnly), groupBy: z.enum(['course', 'teacher']).default('course') })
  .refine(fromBeforeTo, rangeIssue);

export const engagementFilters = reportSelector;
export const workloadFilters = reportSelector;

export type EnrollmentFilters = z.infer<typeof enrollmentFilters>;
export type AttendanceFilters = z.infer<typeof attendanceFilters>;
export type PerformanceFilters = z.infer<typeof performanceFilters>;
export type CompletionFilters = z.infer<typeof completionFilters>;
export type EngagementFilters = z.infer<typeof engagementFilters>;
export type WorkloadFilters = z.infer<typeof workloadFilters>;
