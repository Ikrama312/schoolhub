import { z } from 'zod';
import { bandsSchema } from '@/lib/validators/gradebook';
import type { StudentTermResult } from '@/server/gradebook/grade-calc';

/**
 * PRD-11 report card snapshot v1 (FR-30, api-contracts ReportCardSnapshotV1). Frozen at
 * generation; read and print render it as is and never recompute (FR-31).
 */

const scaleShape = z.object({ name: z.string(), bands: bandsSchema });

export const snapshotSchema = z.object({
  v: z.literal(1),
  school: z.object({ name: z.string(), logoUrl: z.string().nullable() }),
  student: z.object({
    name: z.string(),
    admissionNumber: z.string().nullable(),
    gradeLevel: z.string(),
    section: z.string(),
    homeroomTeacher: z.string().nullable(),
  }),
  term: z.object({ name: z.string(), startDate: z.string(), endDate: z.string(), academicYear: z.string() }),
  courses: z.array(
    z.object({
      subject: z.string(),
      code: z.string(),
      teacher: z.string().nullable(),
      percent: z.string().nullable(),
      letter: z.string().nullable(),
      descriptor: z.string().nullable(),
      teacherComment: z.string().nullable(),
      scaleName: z.string(),
    }),
  ),
  attendance: z.object({ rate: z.string().nullable(), absences: z.number().int(), lates: z.number().int(), counts: z.record(z.number().int()) }),
  scale: scaleShape,
  extraScales: z.array(scaleShape),
});
export type ReportCardSnapshot = z.infer<typeof snapshotSchema>;

export interface SnapshotStudent {
  name: string;
  admissionNumber: string | null;
  gradeLevel: string;
  section: string;
  homeroomTeacher: string | null;
}
export interface SnapshotCourse {
  subject: string;
  code: string;
  teacher: string | null;
  scale: { name: string; bands: z.infer<typeof bandsSchema> } | null;
}
export interface SnapshotAttendance {
  rate: number | null;
  present: number;
  absent: number;
  late: number;
  excused: number;
}

/** Pure: one card's frozen payload. `computed[i]` is the shared calc result for `courses[i]`. */
export function buildSnapshot(
  student: SnapshotStudent,
  courses: readonly SnapshotCourse[],
  computed: readonly StudentTermResult[],
  attendance: SnapshotAttendance | null,
  school: { name: string; logoUrl: string | null },
  term: { name: string; startDate: string; endDate: string; academicYear: string },
  scale: { name: string; bands: z.infer<typeof bandsSchema> } | null,
): ReportCardSnapshot {
  const legend = scale ?? { name: 'No grading scale', bands: [{ letter: '—', minPercent: 0 }] };
  const extra = new Map<string, { name: string; bands: z.infer<typeof bandsSchema> }>();
  for (const c of courses) if (c.scale && c.scale.name !== legend.name) extra.set(c.scale.name, c.scale);
  const a = attendance ?? { rate: null, present: 0, absent: 0, late: 0, excused: 0 };
  return {
    v: 1,
    school,
    student,
    term,
    courses: courses.map((c, i) => ({
      subject: c.subject,
      code: c.code,
      teacher: c.teacher,
      percent: computed[i].percent,
      letter: computed[i].letter,
      descriptor: computed[i].descriptor,
      teacherComment: computed[i].override?.teacherComment ?? null,
      scaleName: c.scale?.name ?? legend.name,
    })),
    // B13: rate is the existing attendanceRate() output from getReport, formatted to 1 dp.
    attendance: {
      rate: a.rate === null ? null : a.rate.toFixed(1),
      absences: a.absent,
      lates: a.late,
      counts: { present: a.present, absent: a.absent, late: a.late, excused: a.excused },
    },
    scale: legend,
    extraScales: [...extra.values()],
  };
}
