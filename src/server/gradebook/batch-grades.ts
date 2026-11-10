import { prisma } from '@/server/db';
import { computeCourseResult, loadCourseTermData } from './load';

/**
 * PRD-16 §3.4: term percents for many students at once (FR-19, FR-25, FR-36). A fixed number of
 * queries (enrolments + the shared PRD-11 loader), grouped in memory, then the same
 * computeStudentTerm every other screen uses — so numbers equal the student Grades tab (FR-13).
 * Visible items only, matching getStudentGrades.
 */
export interface TermPercent {
  courseId: string;
  percent: number | null;
  letter: string | null;
}

export async function loadTermPercents(termId: string, studentIds?: string[], now = new Date()): Promise<Map<string, TermPercent[]>> {
  const result = new Map<string, TermPercent[]>();
  if (studentIds?.length === 0) return result;
  const term = await prisma.term.findUnique({ where: { id: termId }, select: { academicYearId: true } });
  if (!term) return result;

  const enrollments = await prisma.enrollment.findMany({
    where: { status: 'ACTIVE', course: { academicYearId: term.academicYearId }, ...(studentIds ? { studentId: { in: studentIds } } : {}) },
    select: { studentId: true, courseId: true },
    orderBy: { course: { name: 'asc' } },
  });
  if (!enrollments.length) return result;

  const courseIds = [...new Set(enrollments.map((e) => e.courseId))];
  const data = await loadCourseTermData(courseIds, termId, studentIds, { visibleOnly: true });
  for (const { studentId, courseId } of enrollments) {
    const r = computeCourseResult(data, courseId, studentId, now);
    const list = result.get(studentId) ?? [];
    list.push({ courseId, percent: r.percent === null ? null : Number(r.percent), letter: r.letter });
    result.set(studentId, list);
  }
  return result;
}
