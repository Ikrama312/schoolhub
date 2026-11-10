import { z } from 'zod';

/**
 * PRD-07 validation (FR-36), shared by RegisterForm and every attendance
 * handler. Role-dependent rules (EXCUSED = ADMIN, or a TEACHER when an
 * APPROVED absence note covers the student/date/period (PRD-15 FR-25); the
 * 14-day window; future dates) live in the service against the user, not here.
 */

export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'] as const;
export const ATTENDANCE_MODES = ['PER_PERIOD', 'DAILY_HOMEROOM', 'BOTH'] as const;
export const attendanceStatus = z.enum(ATTENDANCE_STATUSES);
export const attendanceMode = z.enum(ATTENDANCE_MODES);
export type AttendanceStatusValue = z.infer<typeof attendanceStatus>;

export const NOTE_MAX = 500;
export const MINUTES_LATE_MAX = 240;
export const MAX_REPORT_DAYS = 366;

export const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use yyyy-MM-dd')
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), 'Invalid date');

const id = z.string().min(1);

const courseKey = z.object({ courseId: id, date: dateOnly, periodId: id });
const sectionKey = z.object({ sectionId: id, date: dateOnly });

/** Course register or daily register -- exactly one (FR-2). */
export const registerQuery = z.union([courseKey.strict(), sectionKey.strict()]);
export type RegisterKey = z.infer<typeof registerQuery>;

export const registerRecord = z
  .object({
    studentId: id,
    status: attendanceStatus,
    minutesLate: z.number().int().optional(),
    note: z.string().trim().max(NOTE_MAX, `Note must be ${NOTE_MAX} characters or fewer`).optional(),
  })
  .superRefine((r, ctx) => {
    if (r.status === 'LATE') {
      if (r.minutesLate === undefined || r.minutesLate < 1 || r.minutesLate > MINUTES_LATE_MAX) {
        ctx.addIssue({ code: 'custom', path: ['minutesLate'], message: `Minutes late must be 1–${MINUTES_LATE_MAX}` });
      }
    } else if (r.minutesLate !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['minutesLate'], message: 'Minutes late is only allowed for LATE' });
    }
  });
export type RegisterRecordInput = z.infer<typeof registerRecord>;

const records = z
  .array(registerRecord)
  .min(1, 'Mark at least one student')
  .refine((rs) => new Set(rs.map((r) => r.studentId)).size === rs.length, 'Duplicate studentId');

export const registerPutBody = z.union([
  courseKey.extend({ records }).strict(),
  sectionKey.extend({ records }).strict(),
]);
export type RegisterPutBody = z.infer<typeof registerPutBody>;

export const studentAttendanceQuery = z
  .object({ from: dateOnly.optional(), to: dateOnly.optional() })
  .refine((q) => !q.from || !q.to || q.to >= q.from, { message: '`to` must be on or after `from`', path: ['to'] });

export const courseMatrixQuery = z.object({});

export const overviewQuery = z.object({ date: dateOnly.optional() });

function daysBetween(from: string, to: string) {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

export const reportFilters = z
  .object({
    from: dateOnly,
    to: dateOnly,
    gradeLevelId: id.optional(),
    sectionId: id.optional(),
    courseId: id.optional(),
    status: attendanceStatus.optional(),
    format: z.literal('csv').optional(),
    // Pagination is read by parsePagination; accepted here so parseQuery doesn't choke.
    page: z.string().optional(),
    pageSize: z.string().optional(),
  })
  .refine((f) => f.to >= f.from, { message: '`to` must be on or after `from`', path: ['to'] })
  .refine((f) => daysBetween(f.from, f.to) <= MAX_REPORT_DAYS, {
    message: `Range must be ${MAX_REPORT_DAYS} days or fewer`,
    path: ['to'],
  });
export type ReportFilters = z.infer<typeof reportFilters>;

export const remindBody = z.object({ courseId: id, periodId: id, date: dateOnly });

export const attendanceSettingsPatch = z
  .object({
    attendanceMode: attendanceMode.optional(),
    attendanceAlertThreshold: z.number().int().min(0).max(100).optional(),
  })
  .strict()
  .refine((p) => Object.values(p).some((v) => v !== undefined), 'Provide at least one field');
export type AttendanceSettingsPatch = z.infer<typeof attendanceSettingsPatch>;
