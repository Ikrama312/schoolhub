import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { AppError, type PaginationParams } from '@/server/http';
import { audit } from '@/server/audit';
import type { AccessUser } from '@/server/auth/student-access';
import { notify, notifyStudentAndParents } from '@/server/notifications/notify';
import { getSchoolTimezone } from '@/server/assignments/assignments-service';
import { fixed2 } from '@/server/assignments/grading-math';
import { formatInSchoolTz } from '@/lib/dates';
import { logger } from '@/lib/logger';
import {
  questionSchema,
  quizSettingsSchema,
  type AccommodationInput,
  type QuestionInput,
  type QuestionPatch,
  type QuizPatch,
  type QuizSettings,
} from '@/lib/validators/quiz';
import { attemptLimit, canPublish, percentOf, resultsVisible } from './grading';
import { toManagerQuestion, toStudentQuiz, totalPoints, type StudentQuiz } from './serializers';
import { canManageCourse, manageCourseOrNotFound, quizNotFound, viewCourseOrNotFound } from './access';
import { autoGradeAnswers, ensureNotExpired, ensureQuizAttemptsNotExpired, getAccommodation, quizSelect, recomputeAttempt } from './attempt-service';

/**
 * PRD-10 quiz authoring, listing and teacher actions (system-design §3.1, §4.1, §4.5).
 * Route handlers and server pages stay thin; every write is access-checked here.
 */

type Tx = Prisma.TransactionClient;

export const LOCK_MESSAGE = 'Quiz has attempts — only text, explanation and accepted answers can change. Use Regrade after editing accepted answers.';
const courseNotFound = () => new AppError('NOT_FOUND', 'Course not found');
const questionNotFound = () => new AppError('NOT_FOUND', 'Question not found');
const iso = (d: Date | null) => (d ? d.toISOString() : null);

// ---------------------------------------------------------------------------
// Manager quiz payload
// ---------------------------------------------------------------------------

async function loadManagerQuiz(quizId: string, db: Tx | typeof prisma = prisma) {
  const quiz = await db.quiz.findUnique({
    where: { id: quizId },
    include: { questions: { orderBy: { order: 'asc' } }, _count: { select: { attempts: true } } },
  });
  if (!quiz) throw quizNotFound();
  return quiz;
}
type ManagerQuizRow = Awaited<ReturnType<typeof loadManagerQuiz>>;

function toManagerQuiz(q: ManagerQuizRow) {
  return {
    id: q.id,
    courseId: q.courseId,
    title: q.title,
    instructions: q.instructions,
    isPractice: q.isPractice,
    availableFrom: q.availableFrom.toISOString(),
    availableUntil: q.availableUntil.toISOString(),
    timeLimitMinutes: q.timeLimitMinutes,
    maxAttempts: q.maxAttempts,
    scoringPolicy: q.scoringPolicy,
    shuffleQuestions: q.shuffleQuestions,
    shuffleOptions: q.shuffleOptions,
    oneQuestionPerPage: q.oneQuestionPerPage,
    resultsVisibility: q.resultsVisibility,
    showCorrectAnswers: q.showCorrectAnswers,
    status: q.status,
    resultsReleasedAt: iso(q.resultsReleasedAt),
    createdById: q.createdById,
    createdAt: q.createdAt.toISOString(),
    updatedAt: q.updatedAt.toISOString(),
    questions: q.questions.map(toManagerQuestion),
    totalPoints: totalPoints(q.questions),
    attemptCount: q._count.attempts,
    locked: q._count.attempts > 0,
    publishProblems: canPublish(q.questions),
  };
}
export type ManagerQuiz = ReturnType<typeof toManagerQuiz>;

/** Manager-only quiz (FR-6..FR-10). */
export async function getQuizForManager(user: AccessUser, quizId: string) {
  const quiz = await loadManagerQuiz(quizId);
  await manageCourseOrNotFound(user, quiz.courseId);
  return toManagerQuiz(quiz);
}

/** Start-screen quiz for a STUDENT (own attempts) or PARENT (zeros). DRAFT → NOT_FOUND. */
export async function getQuizForStudent(user: AccessUser, quizId: string, now = new Date()): Promise<StudentQuiz> {
  const quiz = await prisma.quiz.findUnique({ where: { id: quizId }, select: { ...quizSelect, questions: { select: { points: true } } } });
  if (!quiz || quiz.status === 'DRAFT') throw quizNotFound();
  await viewCourseOrNotFound(user, quiz.courseId);
  if (user.role !== 'STUDENT') {
    return toStudentQuiz(quiz, quiz.questions, { now, extraTimeMinutes: 0, extraAttempts: 0, attemptsUsed: 0, inProgressAttemptId: null });
  }
  const inProgress = await prisma.quizAttempt.findFirst({ where: { quizId, studentId: user.id, status: 'IN_PROGRESS' }, select: { id: true, status: true, deadlineAt: true } });
  const expired = inProgress ? await ensureNotExpired(inProgress, now) : false;
  const [acc, attemptsUsed] = await Promise.all([getAccommodation(quizId, user.id), prisma.quizAttempt.count({ where: { quizId, studentId: user.id } })]);
  return toStudentQuiz(quiz, quiz.questions, { now, ...acc, attemptsUsed, inProgressAttemptId: inProgress && !expired ? inProgress.id : null });
}

/** GET /api/quizzes/:id — manager gets everything, everyone else the allow-listed StudentQuiz. */
export async function getQuiz(user: AccessUser, quizId: string) {
  const quiz = await prisma.quiz.findUnique({ where: { id: quizId }, select: { courseId: true } });
  if (!quiz) throw quizNotFound();
  if (await canManageCourse(user, quiz.courseId)) return getQuizForManager(user, quizId);
  return getQuizForStudent(user, quizId);
}

// ---------------------------------------------------------------------------
// Course list (FR-11, FR-33)
// ---------------------------------------------------------------------------

type Group = 'UPCOMING' | 'AVAILABLE' | 'COMPLETED' | 'MISSED';

export async function listCourseQuizzes(user: AccessUser, courseId: string, page: PaginationParams, now = new Date()) {
  await viewCourseOrNotFound(user, courseId, courseNotFound);
  const manager = await canManageCourse(user, courseId);
  const where: Prisma.QuizWhereInput = manager ? { courseId } : { courseId, status: { in: ['PUBLISHED', 'CLOSED'] } };
  const [total, quizzes] = await Promise.all([
    prisma.quiz.count({ where }),
    prisma.quiz.findMany({
      where,
      select: { ...quizSelect, questions: { select: { points: true } } },
      orderBy: { availableFrom: 'desc' },
      skip: page.skip,
      take: page.take,
    }),
  ]);
  const meta = { page: page.page, pageSize: page.pageSize, total };

  if (manager) {
    for (const q of quizzes) await ensureQuizAttemptsNotExpired(q.id, now);
    const attempts = await prisma.quizAttempt.findMany({
      where: { quizId: { in: quizzes.map((q) => q.id) } },
      select: { quizId: true, status: true, score: true, maxScore: true },
    });
    const items = quizzes.map((q) => {
      const mine = attempts.filter((a) => a.quizId === q.id);
      const graded = mine.filter((a) => a.status === 'GRADED' && a.score !== null).map((a) => percentOf(a.score!, a.maxScore) ?? 0);
      return {
        role: 'MANAGER' as const,
        id: q.id,
        title: q.title,
        status: q.status,
        isPractice: q.isPractice,
        availableFrom: q.availableFrom.toISOString(),
        availableUntil: q.availableUntil.toISOString(),
        timeLimitMinutes: q.timeLimitMinutes,
        resultsVisibility: q.resultsVisibility,
        questionCount: q.questions.length,
        totalPoints: totalPoints(q.questions),
        attemptCount: mine.length,
        averagePercent: graded.length ? Math.round((graded.reduce((s, p) => s + p, 0) / graded.length) * 10) / 10 : null,
        needsGradingCount: mine.filter((a) => a.status === 'NEEDS_GRADING').length,
      };
    });
    return { role: 'MANAGER' as const, items, meta };
  }

  const studentIds =
    user.role === 'STUDENT'
      ? [{ id: user.id, name: '' }]
      : (
          await prisma.user.findMany({
            where: { studentLinks: { some: { parentId: user.id } }, enrollments: { some: { courseId, status: 'ACTIVE' } } },
            select: { id: true, firstName: true, lastName: true },
            orderBy: [{ firstName: 'asc' }],
          })
        ).map((s) => ({ id: s.id, name: `${s.firstName} ${s.lastName}` }));
  const ids = studentIds.map((s) => s.id);
  const quizIds = quizzes.map((q) => q.id);

  if (user.role === 'STUDENT') {
    const open = await prisma.quizAttempt.findMany({ where: { quizId: { in: quizIds }, studentId: user.id, status: 'IN_PROGRESS' }, select: { id: true, status: true, deadlineAt: true } });
    for (const a of open) await ensureNotExpired(a, now);
  }
  const [attempts, accs] = await Promise.all([
    prisma.quizAttempt.findMany({
      where: { quizId: { in: quizIds }, studentId: { in: ids } },
      select: { id: true, quizId: true, studentId: true, attemptNumber: true, status: true, submittedAt: true, score: true, maxScore: true },
      orderBy: { attemptNumber: 'asc' },
    }),
    prisma.quizAccommodation.findMany({ where: { quizId: { in: quizIds }, studentId: { in: ids } } }),
  ]);

  const scoreOf = (q: (typeof quizzes)[number], a: (typeof attempts)[number]) => {
    const show = resultsVisible(q, a, now) && a.status === 'GRADED' && a.score !== null;
    return { score: show ? fixed2(a.score!) : null, maxScore: fixed2(a.maxScore), percent: show ? percentOf(a.score!, a.maxScore) : null };
  };

  if (user.role === 'STUDENT') {
    const items = quizzes.map((q) => {
      const mine = attempts.filter((a) => a.quizId === q.id);
      const acc = accs.find((x) => x.quizId === q.id);
      const inProgress = mine.find((a) => a.status === 'IN_PROGRESS');
      const quiz = toStudentQuiz(q, q.questions, {
        now,
        extraTimeMinutes: acc?.extraTimeMinutes ?? 0,
        extraAttempts: acc?.extraAttempts ?? 0,
        attemptsUsed: mine.length,
        inProgressAttemptId: inProgress?.id ?? null,
      });
      const submitted = mine.filter((a) => a.status !== 'IN_PROGRESS');
      let group: Group;
      if (now < q.availableFrom) group = 'UPCOMING';
      else if (quiz.isOpen && (inProgress || mine.length < attemptLimit(q.maxAttempts, acc?.extraAttempts ?? 0))) group = 'AVAILABLE';
      else if (submitted.length) group = 'COMPLETED';
      else group = 'MISSED';
      const latest = submitted.at(-1);
      return {
        role: 'STUDENT' as const,
        quiz,
        group,
        latestResult: latest ? { attemptId: latest.id, status: latest.status, ...scoreOf(q, latest) } : null,
      };
    });
    return { role: 'STUDENT' as const, items, meta };
  }

  // PARENT: one row per linked child × quiz; only visible results, read-only.
  const items = studentIds.flatMap((child) =>
    quizzes.map((q) => ({
      role: 'PARENT' as const,
      student: child,
      quiz: toStudentQuiz(q, q.questions, { now, extraTimeMinutes: 0, extraAttempts: 0, attemptsUsed: 0, inProgressAttemptId: null }),
      results: attempts
        .filter((a) => a.quizId === q.id && a.studentId === child.id && a.submittedAt && resultsVisible(q, a, now))
        .map((a) => ({ attemptId: a.id, attemptNumber: a.attemptNumber, submittedAt: a.submittedAt!.toISOString(), ...scoreOf(q, a) })),
    })),
  );
  return { role: 'PARENT' as const, items, meta };
}
export type CourseQuizList = Awaited<ReturnType<typeof listCourseQuizzes>>;

// ---------------------------------------------------------------------------
// Create / update / delete (FR-6, FR-9, FR-29, FR-31)
// ---------------------------------------------------------------------------

function settingsData(s: QuizSettings) {
  return {
    title: s.title,
    instructions: s.instructions,
    isPractice: s.isPractice,
    availableFrom: s.availableFrom,
    availableUntil: s.availableUntil,
    timeLimitMinutes: s.timeLimitMinutes,
    maxAttempts: s.maxAttempts,
    scoringPolicy: s.scoringPolicy,
    shuffleQuestions: s.shuffleQuestions,
    shuffleOptions: s.shuffleOptions,
    oneQuestionPerPage: s.oneQuestionPerPage,
    resultsVisibility: s.resultsVisibility,
    showCorrectAnswers: s.showCorrectAnswers,
  };
}

export async function createQuiz(user: AccessUser, courseId: string, input: QuizSettings, request?: Request) {
  await manageCourseOrNotFound(user, courseId, courseNotFound);
  const quiz = await prisma.quiz.create({ data: { ...settingsData(input), courseId, createdById: user.id } });
  await audit({ actorId: user.id, action: 'quiz.create', entityType: 'Quiz', entityId: quiz.id, metadata: { courseId }, request });
  return toManagerQuiz(await loadManagerQuiz(quiz.id));
}

async function notifyPublished(quizId: string) {
  try {
    const q = await prisma.quiz.findUniqueOrThrow({ where: { id: quizId }, select: { id: true, title: true, courseId: true, availableFrom: true, course: { select: { name: true } } } });
    const [students, tz] = await Promise.all([
      prisma.enrollment.findMany({ where: { courseId: q.courseId, status: 'ACTIVE' }, select: { studentId: true } }),
      getSchoolTimezone(),
    ]);
    await notify({
      type: 'quiz.published',
      userIds: students.map((s) => s.studentId),
      title: `New quiz: ${q.title}`,
      body: `${q.course.name} — opens ${formatInSchoolTz(q.availableFrom, 'EEE d MMM yyyy, HH:mm', tz)}`,
      link: `/quizzes/${q.id}/take`,
    });
  } catch (error) {
    logger.error('quiz.published notify failed', { quizId, message: error instanceof Error ? error.message : String(error) });
  }
}

export async function updateQuiz(user: AccessUser, quizId: string, patch: QuizPatch, request?: Request) {
  const existing = await loadManagerQuiz(quizId);
  await manageCourseOrNotFound(user, existing.courseId);
  const { status, ...settings } = patch;
  const settingKeys = Object.keys(settings).filter((k) => settings[k as keyof typeof settings] !== undefined);

  if (status) {
    const allowed = (existing.status === 'DRAFT' && status === 'PUBLISHED') || (existing.status === 'PUBLISHED' && status === 'CLOSED');
    if (!allowed) throw new AppError('CONFLICT', `A ${existing.status.toLowerCase()} quiz cannot be ${status === 'PUBLISHED' ? 'published' : 'closed'}.`);
    if (status === 'PUBLISHED') {
      const problems = canPublish(existing.questions);
      if (problems.length) throw new AppError('VALIDATION_ERROR', 'This quiz cannot be published yet.', { problems });
    }
  }
  // Cross-field rules run on stored ⊕ patch (api-contracts QuizSettingsInput).
  const merged = settingKeys.length ? quizSettingsSchema.parse({ ...toManagerQuiz(existing), ...settings }) : null;

  const published = await prisma.$transaction(async (tx) => {
    if (merged) await tx.quiz.update({ where: { id: quizId }, data: settingsData(merged) });
    if (status === 'PUBLISHED') return (await tx.quiz.updateMany({ where: { id: quizId, status: 'DRAFT' }, data: { status: 'PUBLISHED' } })).count === 1;
    if (status === 'CLOSED') await tx.quiz.updateMany({ where: { id: quizId, status: 'PUBLISHED' }, data: { status: 'CLOSED' } });
    return false;
  });
  await audit({ actorId: user.id, action: 'quiz.update', entityType: 'Quiz', entityId: quizId, metadata: { fields: settingKeys, status }, request });
  if (published) await notifyPublished(quizId); // A9: exactly once, after commit
  return toManagerQuiz(await loadManagerQuiz(quizId));
}

export async function deleteQuiz(user: AccessUser, quizId: string, request?: Request) {
  const quiz = await loadManagerQuiz(quizId);
  await manageCourseOrNotFound(user, quiz.courseId);
  if (quiz._count.attempts > 0) throw new AppError('CONFLICT', 'This quiz has attempts and cannot be deleted.');
  await prisma.quiz.delete({ where: { id: quizId } });
  await audit({ actorId: user.id, action: 'quiz.delete', entityType: 'Quiz', entityId: quizId, metadata: { courseId: quiz.courseId, title: quiz.title }, request });
  return { id: quizId };
}

// ---------------------------------------------------------------------------
// Questions behind the edit lock (FR-7, FR-10, FR-39)
// ---------------------------------------------------------------------------

async function managedQuizForWrite(user: AccessUser, quizId: string) {
  const quiz = await prisma.quiz.findUnique({ where: { id: quizId }, select: { id: true, courseId: true, _count: { select: { attempts: true } } } });
  if (!quiz) throw quizNotFound();
  await manageCourseOrNotFound(user, quiz.courseId);
  return { ...quiz, locked: quiz._count.attempts > 0 };
}

const FILE_REF = /\/api\/files\/([A-Za-z0-9_-]+)/g;

/** FR-39: attach unattached 'quiz' uploads the prompt references, so the quiz resolver governs them. */
async function attachPromptFiles(tx: Tx, user: AccessUser, quizId: string, prompt: string) {
  const ids = [...new Set([...prompt.matchAll(FILE_REF)].map((m) => m[1]))];
  if (!ids.length) return;
  await tx.fileObject.updateMany({
    where: { id: { in: ids }, context: 'quiz', contextId: null, ...(user.role === 'ADMIN' ? {} : { ownerId: user.id }) },
    data: { contextId: quizId },
  });
}

function questionData(q: QuestionInput) {
  return {
    type: q.type,
    prompt: q.prompt,
    points: q.points,
    options: q.type === 'SINGLE_CHOICE' || q.type === 'MULTIPLE_CHOICE' ? (q.options as Prisma.InputJsonValue) : Prisma.DbNull,
    correct: q.correct as Prisma.InputJsonValue,
    explanation: q.explanation,
    caseSensitive: q.type === 'SHORT_ANSWER' ? q.caseSensitive : false,
  };
}

export async function addQuestion(user: AccessUser, quizId: string, input: QuestionInput) {
  const quiz = await managedQuizForWrite(user, quizId);
  if (quiz.locked) throw new AppError('CONFLICT', LOCK_MESSAGE);
  const q = await prisma.$transaction(async (tx) => {
    const last = await tx.question.aggregate({ where: { quizId }, _max: { order: true } });
    const created = await tx.question.create({ data: { ...questionData(input), quizId, order: (last._max.order ?? -1) + 1 } });
    await attachPromptFiles(tx, user, quizId, input.prompt);
    return created;
  });
  return toManagerQuestion(q);
}

async function loadQuestion(user: AccessUser, questionId: string) {
  const q = await prisma.question.findUnique({ where: { id: questionId } });
  if (!q) throw questionNotFound();
  const quiz = await managedQuizForWrite(user, q.quizId).catch(() => {
    throw questionNotFound();
  });
  return { q, locked: quiz.locked };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export async function updateQuestion(user: AccessUser, questionId: string, patch: QuestionPatch) {
  const { q, locked } = await loadQuestion(user, questionId);
  const current = toManagerQuestion(q);
  if (locked) {
    // Keys whose value is unchanged are fine (the builder sends the whole question).
    const changed = (Object.keys(patch) as (keyof QuestionPatch)[]).filter((k) =>
      k === 'points' ? fixed2(String(patch.points)) !== current.points : !same(patch[k], current[k]),
    );
    const allowed = new Set<string>(['prompt', 'explanation', ...(q.type === 'SHORT_ANSWER' ? ['caseSensitive', 'correct'] : [])]);
    const correctOk = !changed.includes('correct') || Object.keys(patch.correct ?? {}).every((k) => k === 'accepted');
    if (!changed.every((k) => allowed.has(k)) || !correctOk) throw new AppError('CONFLICT', LOCK_MESSAGE);
  }
  const merged = questionSchema.parse({ ...current, ...patch });
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.question.update({ where: { id: questionId }, data: questionData(merged) });
    await attachPromptFiles(tx, user, q.quizId, merged.prompt);
    return row;
  });
  return toManagerQuestion(updated); // A3: editing never regrades by itself
}

export async function deleteQuestion(user: AccessUser, questionId: string) {
  const { q, locked } = await loadQuestion(user, questionId);
  if (locked) throw new AppError('CONFLICT', LOCK_MESSAGE);
  await prisma.$transaction([
    prisma.question.delete({ where: { id: questionId } }),
    prisma.question.updateMany({ where: { quizId: q.quizId, order: { gt: q.order } }, data: { order: { decrement: 1 } } }),
  ]);
  return { id: questionId };
}

export async function reorderQuestions(user: AccessUser, quizId: string, questionIds: string[]) {
  const quiz = await managedQuizForWrite(user, quizId);
  if (quiz.locked) throw new AppError('CONFLICT', LOCK_MESSAGE);
  const existing = await prisma.question.findMany({ where: { quizId }, select: { id: true } });
  const ids = new Set(existing.map((e) => e.id));
  if (questionIds.length !== ids.size || new Set(questionIds).size !== ids.size || !questionIds.every((id) => ids.has(id))) {
    throw new AppError('VALIDATION_ERROR', 'questionIds must list every question of this quiz exactly once.');
  }
  await prisma.$transaction(questionIds.map((id, order) => prisma.question.update({ where: { id }, data: { order } })));
  return (await prisma.question.findMany({ where: { quizId }, orderBy: { order: 'asc' } })).map(toManagerQuestion);
}

// ---------------------------------------------------------------------------
// Teacher actions (FR-10, FR-20, FR-28, FR-30, FR-38)
// ---------------------------------------------------------------------------

export async function regradeQuiz(user: AccessUser, quizId: string, request?: Request) {
  const quiz = await managedQuizForWrite(user, quizId);
  const result = await prisma.$transaction(
    async (tx) => {
      const attempts = await tx.quizAttempt.findMany({ where: { quizId, status: { not: 'IN_PROGRESS' } }, select: { id: true, questionOrder: true } });
      let changedAnswerCount = 0;
      for (const a of attempts) {
        changedAnswerCount += await autoGradeAnswers(tx, a.id, a.questionOrder, { createMissing: false });
        await recomputeAttempt(tx, a.id);
      }
      return { attemptCount: attempts.length, changedAnswerCount };
    },
    { timeout: 60_000 },
  );
  await audit({ actorId: user.id, action: 'quiz.regrade', entityType: 'Quiz', entityId: quiz.id, metadata: result, request });
  return result;
}

/** quiz.results_released to every student with a submitted attempt, and their parents. Never throws. */
export async function notifyResultsReleased(quizId: string) {
  try {
    const q = await prisma.quiz.findUniqueOrThrow({ where: { id: quizId }, select: { id: true, title: true, course: { select: { name: true } } } });
    const rows = await prisma.quizAttempt.findMany({ where: { quizId, status: { not: 'IN_PROGRESS' } }, select: { studentId: true }, distinct: ['studentId'] });
    if (!rows.length) return;
    await notifyStudentAndParents({
      type: 'quiz.results_released',
      studentIds: rows.map((r) => r.studentId),
      title: `Quiz results released: ${q.title}`,
      body: q.course.name,
      link: `/quizzes/${q.id}/take`,
      email: { template: 'generic-notification' },
    });
  } catch (error) {
    logger.error('quiz.results_released notify failed', { quizId, message: error instanceof Error ? error.message : String(error) });
  }
}

export async function releaseResults(user: AccessUser, quizId: string, request?: Request, now = new Date()) {
  await managedQuizForWrite(user, quizId);
  const { count } = await prisma.quiz.updateMany({ where: { id: quizId, resultsVisibility: 'MANUAL', resultsReleasedAt: null }, data: { resultsReleasedAt: now } });
  const quiz = await prisma.quiz.findUniqueOrThrow({ where: { id: quizId }, select: { resultsVisibility: true, resultsReleasedAt: true } });
  if (quiz.resultsVisibility !== 'MANUAL') throw new AppError('CONFLICT', 'Only quizzes with manual results visibility can be released.');
  if (count === 1) {
    await notifyResultsReleased(quizId);
    await audit({ actorId: user.id, action: 'quiz.release_results', entityType: 'Quiz', entityId: quizId, request });
  }
  return { resultsReleasedAt: quiz.resultsReleasedAt!.toISOString(), notified: count === 1 };
}

export async function upsertAccommodation(user: AccessUser, quizId: string, studentId: string, input: AccommodationInput, request?: Request) {
  const quiz = await managedQuizForWrite(user, quizId);
  const enrolled = await prisma.enrollment.findFirst({ where: { courseId: quiz.courseId, studentId, status: 'ACTIVE' }, select: { id: true } });
  if (!enrolled) throw new AppError('NOT_FOUND', 'Student not found in this course');
  const row = await prisma.quizAccommodation.upsert({
    where: { quizId_studentId: { quizId, studentId } },
    create: { quizId, studentId, ...input },
    update: input,
  });
  await audit({ actorId: user.id, action: 'quiz.accommodation', entityType: 'Quiz', entityId: quizId, metadata: { studentId, ...input }, request });
  return { quizId, studentId, extraTimeMinutes: row.extraTimeMinutes, extraAttempts: row.extraAttempts };
}

/** Builder accommodations table (FR-28): ACTIVE enrollees with their current accommodation. */
export async function listAccommodations(user: AccessUser, quizId: string) {
  const quiz = await managedQuizForWrite(user, quizId);
  const [enrollments, accs] = await Promise.all([
    prisma.enrollment.findMany({
      where: { courseId: quiz.courseId, status: 'ACTIVE' },
      select: { student: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
    }),
    prisma.quizAccommodation.findMany({ where: { quizId } }),
  ]);
  return enrollments.map(({ student: s }) => {
    const a = accs.find((x) => x.studentId === s.id);
    return { studentId: s.id, name: `${s.firstName} ${s.lastName}`, extraTimeMinutes: a?.extraTimeMinutes ?? 0, extraAttempts: a?.extraAttempts ?? 0 };
  });
}

