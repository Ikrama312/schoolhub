import { prisma } from '@/server/db';
import { logger } from '@/lib/logger';
import { dec } from '@/server/assignments/grading-math';
import { getSchoolTimezone, isAssignmentVisible } from '@/server/assignments/assignments-service';
import { applyScoringPolicy, resultsVisible } from '@/server/quiz/grading';
import { gradeFromQuizScore, gradeFromSubmission, itemFromAssignment, itemFromQuiz } from './gradebook-sync';
import { termFor } from './term-placement';

/**
 * PRD-11 FR-8: one-time, idempotent backfill of items and grades for data that predates the
 * gradebook. Batch-loads per course (NFR-3) and reuses the sync row builders. Existing items are
 * left as they are (teacher edits such as hiding survive); grades are created or corrected.
 */

type GradeRow = { gradeItemId: string; studentId: string; score: string | null; excused: boolean; updatedById: string };

async function writeGrades(rows: GradeRow[]): Promise<number> {
  if (!rows.length) return 0;
  const existing = await prisma.grade.findMany({
    where: { gradeItemId: { in: [...new Set(rows.map((r) => r.gradeItemId))] } },
    select: { gradeItemId: true, studentId: true, score: true, excused: true },
  });
  const byKey = new Map(existing.map((g) => [`${g.gradeItemId}:${g.studentId}`, g]));
  const create: GradeRow[] = [];
  let written = 0;
  for (const r of rows) {
    const g = byKey.get(`${r.gradeItemId}:${r.studentId}`);
    if (!g) {
      if (r.score !== null || r.excused) create.push(r);
      continue;
    }
    const same = g.excused === r.excused && (g.score === null ? r.score === null : r.score !== null && dec(g.score).eq(dec(r.score)));
    if (same) continue;
    await prisma.grade.update({
      where: { gradeItemId_studentId: { gradeItemId: r.gradeItemId, studentId: r.studentId } },
      data: { score: r.score, excused: r.excused, updatedById: r.updatedById },
    });
    written++;
  }
  if (create.length) written += (await prisma.grade.createMany({ data: create, skipDuplicates: true })).count;
  return written;
}

export async function backfillGradebook(now = new Date()): Promise<{ items: number; grades: number }> {
  const tz = await getSchoolTimezone();
  const courses = await prisma.course.findMany({ select: { id: true, academicYearId: true, teacherId: true } });
  const termsByYear = new Map<string, Awaited<ReturnType<typeof prisma.term.findMany>>>();
  let items = 0;
  let grades = 0;

  for (const course of courses) {
    if (!termsByYear.has(course.academicYearId)) {
      termsByYear.set(course.academicYearId, await prisma.term.findMany({ where: { academicYearId: course.academicYearId }, orderBy: { order: 'asc' } }));
    }
    const terms = termsByYear.get(course.academicYearId)!;

    const [assignments, quizzes] = await Promise.all([
      prisma.assignment.findMany({
        where: { courseId: course.id },
        select: {
          id: true, courseId: true, title: true, maxPoints: true, dueAt: true, categoryId: true, status: true, availableFrom: true, archivedAt: true, createdById: true,
          submissions: { where: { status: 'RETURNED' }, select: { studentId: true, status: true, finalScore: true } },
          exemptions: { select: { studentId: true } },
        },
      }),
      prisma.quiz.findMany({
        where: { courseId: course.id, isPractice: false, status: { not: 'DRAFT' } },
        select: {
          id: true, courseId: true, title: true, availableUntil: true, categoryId: true, scoringPolicy: true, resultsVisibility: true, resultsReleasedAt: true, createdById: true,
          questions: { select: { points: true } },
          attempts: { where: { status: 'GRADED' }, select: { studentId: true, score: true, maxScore: true, submittedAt: true } },
        },
      }),
    ]);

    // Items: visible sources, plus archived ones that had been published (hidden, FR-4).
    const newItems = [];
    for (const a of assignments) {
      const visible = isAssignmentVisible(a, now);
      const archivedPublished = !!a.archivedAt && isAssignmentVisible({ ...a, archivedAt: null }, now);
      if (!visible && !archivedPublished) continue;
      const term = termFor(a.dueAt, terms, tz, now);
      if (!term) {
        logger.warn('Backfill skipped assignment: no term (A6)', { assignmentId: a.id });
        continue;
      }
      newItems.push({ ...itemFromAssignment(a, term.id), isVisible: visible });
    }
    for (const q of quizzes) {
      const term = termFor(q.availableUntil, terms, tz, now);
      if (!term) {
        logger.warn('Backfill skipped quiz: no term (A6)', { quizId: q.id });
        continue;
      }
      newItems.push(itemFromQuiz(q, q.questions.reduce((s, x) => s.plus(dec(x.points)), dec(0)), term.id));
    }
    if (newItems.length) items += (await prisma.gradeItem.createMany({ data: newItems, skipDuplicates: true })).count;

    const sourceIds = [...assignments.map((a) => a.id), ...quizzes.map((q) => q.id)];
    const itemRows = await prisma.gradeItem.findMany({ where: { sourceId: { in: sourceIds } }, select: { id: true, sourceId: true, maxPoints: true } });
    const itemBySource = new Map(itemRows.map((i) => [i.sourceId!, i]));

    const rows: GradeRow[] = [];
    for (const a of assignments) {
      const it = itemBySource.get(a.id);
      if (!it) continue;
      const exempt = new Set(a.exemptions.map((e) => e.studentId));
      const students = new Set([...a.submissions.map((s) => s.studentId), ...exempt]);
      for (const studentId of students) {
        const sub = a.submissions.find((s) => s.studentId === studentId) ?? null;
        rows.push({ gradeItemId: it.id, studentId, ...gradeFromSubmission(sub, exempt.has(studentId)), updatedById: a.createdById });
      }
    }
    for (const q of quizzes) {
      const it = itemBySource.get(q.id);
      if (!it || !resultsVisible(q, { status: 'GRADED' }, now)) continue;
      const byStudent = new Map<string, typeof q.attempts>();
      for (const at of q.attempts) byStudent.set(at.studentId, [...(byStudent.get(at.studentId) ?? []), at]);
      for (const [studentId, attempts] of byStudent) {
        const scored = attempts.filter((x) => x.score !== null && x.submittedAt !== null).map((x) => ({ score: x.score!, maxScore: x.maxScore, submittedAt: x.submittedAt! }));
        const score = gradeFromQuizScore(applyScoringPolicy(q.scoringPolicy, scored), it.maxPoints);
        if (score !== null) rows.push({ gradeItemId: it.id, studentId, score, excused: false, updatedById: q.createdById });
      }
    }
    grades += await writeGrades(rows);
  }
  return { items, grades };
}
