import { z } from 'zod';

/**
 * PRD-06 validation (FR-39), shared by the bell-schedule / timetable forms
 * and the /api/periods, /api/school-days, /api/timetable* handlers.
 * academicYearId is never accepted on slot writes; it comes from the course (FR-37).
 */

export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');

export const periodKind = z.enum(['CLASS', 'BREAK', 'LUNCH', 'ASSEMBLY']);

const endAfterStart = { message: 'End time must be after start time', path: ['endTime'] };

const periodBase = z.object({
  name: z.string().trim().min(1, 'Name is required').max(50),
  startTime: hhmm,
  endTime: hhmm,
  kind: periodKind,
});

// 'HH:MM' strings compare correctly as strings (ADR-2).
export const periodSchema = periodBase.refine((p) => p.endTime > p.startTime, endAfterStart);
export type PeriodInput = z.infer<typeof periodSchema>;

export const periodUpdateSchema = periodBase
  .partial()
  .refine((p) => !p.startTime || !p.endTime || p.endTime > p.startTime, endAfterStart);
export type PeriodUpdateInput = z.infer<typeof periodUpdateSchema>;

export const periodReorderSchema = z.object({
  periodIds: z
    .array(z.string().min(1))
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, 'Duplicate period ids'),
});

const dayOfWeek = z.number().int().min(1).max(7);

export const schoolDaysSchema = z.object({
  days: z
    .array(z.object({ dayOfWeek, isTeaching: z.boolean() }))
    .length(7)
    .refine((days) => new Set(days.map((d) => d.dayOfWeek)).size === 7, 'Each day must appear once'),
});
export type SchoolDaysInput = z.infer<typeof schoolDaysSchema>;

export const slotCreateSchema = z.object({
  courseId: z.string().min(1),
  dayOfWeek,
  periodId: z.string().min(1),
  roomId: z.string().min(1).nullable().optional(),
});
export type SlotCreateInput = z.infer<typeof slotCreateSchema>;

export const slotUpdateSchema = z
  .object({
    dayOfWeek: dayOfWeek.optional(),
    periodId: z.string().min(1).optional(),
    roomId: z.string().min(1).nullable().optional(),
  })
  .refine((p) => Object.values(p).some((v) => v !== undefined), 'Provide at least one field');
export type SlotUpdateInput = z.infer<typeof slotUpdateSchema>;

export const timetableView = z.enum(['section', 'teacher', 'room']);
export type TimetableViewKind = z.infer<typeof timetableView>;

export const timetableQuerySchema = z.object({
  view: timetableView,
  id: z.string().min(1),
  academicYearId: z.string().min(1),
});

export const availabilityQuerySchema = z.object({
  courseId: z.string().min(1),
  roomId: z.string().min(1).optional(),
});

export const freeRoomsQuerySchema = z.object({
  dayOfWeek: z.coerce.number().int().min(1).max(7),
  periodId: z.string().min(1),
  academicYearId: z.string().min(1),
  excludeSlotId: z.string().min(1).optional(),
});

export const meTimetableQuerySchema = z.object({
  studentId: z.string().min(1).optional(),
  academicYearId: z.string().min(1).optional(),
});
