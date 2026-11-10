import { prisma } from '@/server/db';
import { visibleWhere } from '@/server/assignments/assignments-service';

/**
 * PRD-16 §3.5: the one "missing work" predicate shared by FR-11 (student due soon),
 * FR-25 (risk), FR-37 (completion report) and the PRD-09 missing reminders.
 *
 * Missing = assignment visible at `now`, dueAt ∈ [from, min(to, now)), not NO_SUBMISSION,
 * student ACTIVE in the course, no Submission and no GradeExemption.
 * One window query, then subtraction in memory.
 */
export interface MissingItem {
  assignmentId: string;
  dueAt: Date;
  courseId: string;
}

export async function missingWork(opts: {
  /** Omit for every enrolled student. */
  studentIds?: string[];
  from: Date;
  to: Date;
  now?: Date;
}): Promise<Map<string, MissingItem[]>> {
  const now = opts.now ?? new Date();
  const end = opts.to < now ? opts.to : now;
  const result = new Map<string, MissingItem[]>();
  if (opts.from >= end || opts.studentIds?.length === 0) return result;

  const only = opts.studentIds ? { studentId: { in: opts.studentIds } } : {};
  const assignments = await prisma.assignment.findMany({
    where: { AND: [visibleWhere(now), { dueAt: { gte: opts.from, lt: end }, submissionType: { not: 'NO_SUBMISSION' } }] },
    select: {
      id: true,
      dueAt: true,
      courseId: true,
      course: { select: { enrollments: { where: { status: 'ACTIVE', ...only }, select: { studentId: true } } } },
      submissions: { where: only, select: { studentId: true } },
      exemptions: { where: only, select: { studentId: true } },
    },
    orderBy: { dueAt: 'asc' },
  });

  for (const a of assignments) {
    const done = new Set([...a.submissions, ...a.exemptions].map((r) => r.studentId));
    for (const { studentId } of a.course.enrollments) {
      if (done.has(studentId)) continue;
      const list = result.get(studentId) ?? [];
      list.push({ assignmentId: a.id, dueAt: a.dueAt, courseId: a.courseId });
      result.set(studentId, list);
    }
  }
  return result;
}
