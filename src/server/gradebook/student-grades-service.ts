import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import { assertCanViewStudent, type AccessUser } from '@/server/auth/student-access';
import { fixed2 } from '@/server/assignments/grading-math';
import { computeCourseResult, loadCourseTermData } from './load';
import { gradeColour, itemPercent, UNCATEGORISED } from './grade-calc';
import { resolveTerm } from './gradebook-service';

/**
 * PRD-11 student/parent grades (FR-26–FR-28, FR-42, NFR-5). Only visible items are loaded (in the
 * query) and the calculation runs over exactly those, so totals match what is shown. The output
 * is a whitelist: no updatedById, no hidden items, no submission/attempt ids.
 */

async function termsFor(termId: string | undefined) {
  if (termId) {
    const t = await prisma.term.findUnique({ where: { id: termId }, select: { academicYearId: true } });
    if (!t) throw new AppError('VALIDATION_ERROR', 'Unknown term.', { fieldErrors: { termId: ['Unknown term'] } });
    return prisma.term.findMany({ where: { academicYearId: t.academicYearId }, orderBy: { order: 'asc' } });
  }
  return prisma.term.findMany({ where: { academicYear: { isCurrent: true } }, orderBy: { order: 'asc' } });
}

export async function getStudentGrades(user: AccessUser, studentId: string, termId?: string, courseId?: string) {
  await assertCanViewStudent(user, studentId);
  const student = await prisma.user.findFirst({ where: { id: studentId, role: 'STUDENT' }, select: { id: true, firstName: true, lastName: true } });
  if (!student) throw new AppError('NOT_FOUND', 'Student not found');
  const terms = await termsFor(termId);
  if (!terms.length) return { student, term: null, terms: [], courses: [] };
  const { term, terms: refs } = await resolveTerm(terms, termId);

  const enrollments = await prisma.enrollment.findMany({
    where: { studentId, status: 'ACTIVE', course: { academicYearId: terms[0].academicYearId, ...(courseId ? { id: courseId } : {}) } },
    select: { course: { select: { id: true, code: true, name: true, teacher: { select: { firstName: true, lastName: true } } } } },
    orderBy: { course: { name: 'asc' } },
  });
  const courses = enrollments.map((e) => e.course);
  const data = await loadCourseTermData(courses.map((c) => c.id), term.id, [studentId], { visibleOnly: true });
  const now = new Date();

  return {
    student,
    term,
    terms: refs,
    courses: courses.map((c) => {
      const result = computeCourseResult(data, c.id, studentId, now);
      const cats = new Map((data.categories.get(c.id) ?? []).map((x) => [x.id, x.name]));
      const dropped = new Set(result.categories.flatMap((x) => x.droppedItemIds));
      return {
        course: { id: c.id, code: c.code, name: c.name, teacherName: `${c.teacher.firstName} ${c.teacher.lastName}` },
        percent: result.percent,
        letter: result.letter,
        descriptor: result.descriptor,
        colour: gradeColour(result.percent),
        categories: result.categories,
        items: (data.items.get(c.id) ?? []).map((i) => {
          const g = data.grades.get(i.id)?.get(studentId);
          const categoryId = i.categoryId && cats.has(i.categoryId) ? i.categoryId : null;
          return {
            id: i.id,
            title: i.title,
            categoryId,
            categoryName: categoryId ? cats.get(categoryId)! : UNCATEGORISED,
            maxPoints: fixed2(i.maxPoints),
            dueAt: i.dueAt?.toISOString() ?? null,
            score: g?.score == null ? null : fixed2(g.score),
            percent: itemPercent(g?.score ?? null, i.maxPoints),
            comment: g?.comment ?? null,
            missing: g?.missing ?? false,
            excused: g?.excused ?? false,
            dropped: dropped.has(i.id),
          };
        }),
      };
    }),
  };
}
export type StudentGrades = Awaited<ReturnType<typeof getStudentGrades>>;
