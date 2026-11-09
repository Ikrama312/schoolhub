import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import { logger } from '@/lib/logger';
import { dec, fixed2, type DecimalValue } from '@/server/assignments/grading-math';
import { getSchoolTimezone, isAssignmentVisible } from '@/server/assignments/assignments-service';
import { getStudentQuizScore } from '@/server/quiz/attempt-service';
import { resultsVisible } from '@/server/quiz/grading';
import { termFor } from './term-placement';

/**
 * PRD-11 source → gradebook sync (FR-3–FR-7, system-design §3.1). Every function is idempotent
 * (GradeItem.sourceId and Grade's composite key, B19). Assignment hooks run inside the caller's
 * transaction; quiz hooks run after commit and never throw.
 *
 * A7: isVisible is written only on source visibility transitions, so a teacher's hide survives
 * plain re-saves of the source.
 */

type Db = Prisma.TransactionClient | PrismaClient;

// ---------------------------------------------------------------------------
// Pure row builders (shared with backfill.ts)
// ---------------------------------------------------------------------------

export function itemFromAssignment(
  a: { id: string; courseId: string; title: string; maxPoints: DecimalValue; dueAt: Date; categoryId: string | null },
  termId: string,
) {
  return {
    courseId: a.courseId,
    categoryId: a.categoryId,
    termId,
    title: a.title,
    maxPoints: fixed2(a.maxPoints),
    dueAt: a.dueAt,
    source: 'ASSIGNMENT' as const,
    sourceId: a.id,
    isVisible: true,
  };
}

export function itemFromQuiz(
  q: { id: string; courseId: string; title: string; availableUntil: Date; categoryId: string | null },
  maxPoints: DecimalValue,
  termId: string,
) {
  return {
    courseId: q.courseId,
    categoryId: q.categoryId,
    termId,
    title: q.title,
    maxPoints: fixed2(maxPoints),
    dueAt: q.availableUntil,
    source: 'QUIZ' as const,
    sourceId: q.id,
    isVisible: true,
  };
}

/** FR-5 / FR-6 / A1: only RETURNED scores sync; an exemption row means excused. */
export function gradeFromSubmission(sub: { status: string; finalScore: DecimalValue | null } | null, exempt: boolean) {
  return {
    score: sub?.status === 'RETURNED' && sub.finalScore !== null ? fixed2(sub.finalScore) : null,
    excused: exempt,
  };
}

/** FR-7: policy score scaled to the item's maxPoints. */
export function gradeFromQuizScore(result: { score: DecimalValue; maxScore: DecimalValue } | null, itemMaxPoints: DecimalValue): string | null {
  if (!result || !dec(result.maxScore).gt(0)) return null;
  return fixed2(dec(result.score).div(dec(result.maxScore)).mul(dec(itemMaxPoints)));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Terms of the course's academic year, ordered. */
export async function courseTerms(db: Db, courseId: string) {
  const course = await db.course.findUnique({ where: { id: courseId }, select: { academicYearId: true } });
  if (!course) return [];
  return db.term.findMany({ where: { academicYearId: course.academicYearId }, orderBy: { order: 'asc' } });
}

async function placeTerm(db: Db, courseId: string, date: Date | null, now: Date) {
  const [terms, tz] = await Promise.all([courseTerms(db, courseId), getSchoolTimezone()]);
  return termFor(date, terms, tz, now)?.id ?? null;
}

/** FR-2: a categoryId on an assignment/quiz must belong to the same course. */
export async function assertCategoryInCourse(db: Db, courseId: string, categoryId: string | null | undefined) {
  if (!categoryId) return;
  const c = await db.gradeCategory.findUnique({ where: { id: categoryId }, select: { courseId: true } });
  if (!c || c.courseId !== courseId) {
    throw new AppError('VALIDATION_ERROR', 'That category does not belong to this course.', { fieldErrors: { categoryId: ['Unknown category'] } });
  }
}

async function upsertItem(
  db: Db,
  sourceId: string,
  visible: boolean,
  wasVisible: boolean | undefined,
  build: (termId: string) => ReturnType<typeof itemFromAssignment> | ReturnType<typeof itemFromQuiz>,
  placementDate: Date,
  courseId: string,
  now: Date,
) {
  const existing = await db.gradeItem.findUnique({ where: { sourceId }, select: { id: true, dueAt: true } });
  if (!existing) {
    if (!visible) return;
    const termId = await placeTerm(db, courseId, placementDate, now);
    if (!termId) {
      logger.warn('Gradebook sync skipped: no term for item (A6)', { sourceId, courseId });
      return;
    }
    // ON CONFLICT DO NOTHING: a concurrent sync of the same source may have created it (B19).
    await db.gradeItem.createMany({ data: [build(termId)], skipDuplicates: true });
    return;
  }
  const { courseId: _c, source: _s, sourceId: _id, isVisible: _v, termId: _t, ...fields } = build('');
  const data: Prisma.GradeItemUncheckedUpdateInput = { ...fields };
  // A10: re-place only when the date moved.
  if (existing.dueAt?.getTime() !== placementDate.getTime()) {
    const termId = await placeTerm(db, courseId, placementDate, now);
    if (termId) data.termId = termId;
  }
  if (!visible) data.isVisible = false;
  else if (wasVisible === false) data.isVisible = true;
  await db.gradeItem.update({ where: { id: existing.id }, data });
}

// ---------------------------------------------------------------------------
// Item sync (FR-3, FR-4)
// ---------------------------------------------------------------------------

/** Create/refresh the item for an assignment. `wasVisible` is the source's visibility before this write. */
export async function upsertItemFromAssignment(db: Db, assignmentId: string, opts: { wasVisible?: boolean; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const a = await db.assignment.findUnique({
    where: { id: assignmentId },
    select: { id: true, courseId: true, title: true, maxPoints: true, dueAt: true, categoryId: true, status: true, availableFrom: true, archivedAt: true },
  });
  if (!a) return;
  await upsertItem(db, a.id, isAssignmentVisible(a, now), opts.wasVisible, (termId) => itemFromAssignment(a, termId), a.dueAt, a.courseId, now);
}

/** A15: PUBLISHED and CLOSED quizzes are visible; practice quizzes never have an item. */
export async function upsertItemFromQuiz(db: Db, quizId: string, opts: { wasVisible?: boolean; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const q = await db.quiz.findUnique({
    where: { id: quizId },
    select: { id: true, courseId: true, title: true, availableUntil: true, categoryId: true, status: true, isPractice: true, questions: { select: { points: true } } },
  });
  if (!q) return;
  if (q.isPractice) return deleteItemForSource(db, q.id);
  const max = q.questions.reduce((s, x) => s.plus(dec(x.points)), dec(0));
  await upsertItem(db, q.id, q.status !== 'DRAFT', opts.wasVisible, (termId) => itemFromQuiz(q, max, termId), q.availableUntil, q.courseId, now);
}

/** Archive → hidden (FR-4). */
export async function hideItemForSource(db: Db, sourceId: string) {
  await db.gradeItem.updateMany({ where: { sourceId }, data: { isVisible: false } });
}

/** Source deleted → item and its grades deleted (cascade). */
export async function deleteItemForSource(db: Db, sourceId: string) {
  await db.gradeItem.deleteMany({ where: { sourceId } });
}

// ---------------------------------------------------------------------------
// Grade sync (FR-5–FR-7)
// ---------------------------------------------------------------------------

/** FR-5/FR-6: call after any write to a submission or exemption. No-op without an item. */
export async function syncSubmissionGrade(db: Db, assignmentId: string, studentId: string, actorId?: string) {
  const item = await db.gradeItem.findUnique({ where: { sourceId: assignmentId }, select: { id: true } });
  if (!item) return;
  const [a, sub, exemption, existing] = await Promise.all([
    db.assignment.findUnique({ where: { id: assignmentId }, select: { createdById: true } }),
    db.submission.findUnique({ where: { assignmentId_studentId: { assignmentId, studentId } }, select: { status: true, finalScore: true } }),
    db.gradeExemption.findUnique({ where: { assignmentId_studentId: { assignmentId, studentId } }, select: { studentId: true } }),
    db.grade.findUnique({ where: { gradeItemId_studentId: { gradeItemId: item.id, studentId } }, select: { studentId: true } }),
  ]);
  const g = gradeFromSubmission(sub, !!exemption);
  if (!existing && g.score === null && !g.excused) return;
  const updatedById = actorId ?? a?.createdById ?? studentId;
  await db.grade.upsert({
    where: { gradeItemId_studentId: { gradeItemId: item.id, studentId } },
    create: { gradeItemId: item.id, studentId, ...g, updatedById },
    update: { ...g, updatedById },
  });
}

/** FR-7: GRADED ∧ results visible ∧ not practice → upsert the policy score. Never throws (runs after commit). */
export async function syncQuizGrade(quizId: string, studentId: string, now = new Date()) {
  try {
    const [quiz, item] = await Promise.all([
      prisma.quiz.findUnique({ where: { id: quizId }, select: { isPractice: true, resultsVisibility: true, availableUntil: true, resultsReleasedAt: true, createdById: true } }),
      prisma.gradeItem.findUnique({ where: { sourceId: quizId }, select: { id: true, maxPoints: true } }),
    ]);
    if (!quiz || !item || quiz.isPractice) return;
    // Unreleased scores are never written (NFR-5 layer 1).
    if (!resultsVisible(quiz, { status: 'GRADED' }, now)) return;
    const result = await getStudentQuizScore(quizId, studentId);
    const score = gradeFromQuizScore(result, item.maxPoints);
    const key = { gradeItemId_studentId: { gradeItemId: item.id, studentId } };
    if (score === null) {
      // e.g. a regrade sent the only graded attempt back to NEEDS_GRADING.
      await prisma.grade.updateMany({ where: { gradeItemId: item.id, studentId }, data: { score: null, updatedById: quiz.createdById } });
      return;
    }
    await prisma.grade.upsert({
      where: key,
      create: { gradeItemId: item.id, studentId, score, updatedById: quiz.createdById },
      update: { score, updatedById: quiz.createdById },
    });
  } catch (error) {
    logger.error('syncQuizGrade failed', { quizId, studentId, message: error instanceof Error ? error.message : String(error) });
  }
}

/** Release / close (R1): every student with a submitted attempt. Never throws. */
export async function syncQuizGrades(quizId: string, now = new Date()) {
  try {
    const rows = await prisma.quizAttempt.findMany({ where: { quizId, status: { not: 'IN_PROGRESS' } }, select: { studentId: true }, distinct: ['studentId'] });
    // ponytail: one getStudentQuizScore per student (~3 queries each); batch like backfill.ts if classes grow past a few hundred.
    for (const r of rows) await syncQuizGrade(quizId, r.studentId, now);
  } catch (error) {
    logger.error('syncQuizGrades failed', { quizId, message: error instanceof Error ? error.message : String(error) });
  }
}
