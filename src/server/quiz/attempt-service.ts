import { randomBytes } from 'node:crypto';
import { Prisma, type Question } from '@prisma/client';
import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import { audit } from '@/server/audit';
import type { AccessUser } from '@/server/auth/student-access';
import { Decimal, dec, fixed2 } from '@/server/assignments/grading-math';
import type { AnswerResponse, ManualGradeInput } from '@/lib/validators/quiz';
import {
  ANSWER_GRACE_MS,
  applyScoringPolicy,
  attemptLimit,
  computeDeadline,
  gradeAnswer,
  needsReview,
  resultsVisible,
  seededShuffle,
} from './grading';
import { syncQuizGrade } from '@/server/gradebook/gradebook-sync';
import { isOpen, toManagerAnswer, toManagerAttempt, toStudentAttempt, toStudentResult } from './serializers';
import { assertCanAccessAttempt, attemptNotFound, manageCourseOrNotFound, quizNotFound, viewCourseOrNotFound } from './access';

/**
 * PRD-10 attempt lifecycle (system-design §4.2–§4.4, §4.7). The server owns time: every function
 * takes `now` from the server clock (ADR-4). submitAttempt() is the single submit path.
 */

type Tx = Prisma.TransactionClient;

/** cuid-shaped id generated up front so the shuffle seed is known before insert (FR-13). */
// ponytail: hand-rolled cuid-like id (no cuid dep installed); swap for @paralleldrive/cuid2 if ids must be true cuids.
const newId = () => `c${Date.now().toString(36)}${randomBytes(8).toString('hex')}`;

export const quizSelect = {
  id: true,
  courseId: true,
  title: true,
  instructions: true,
  isPractice: true,
  status: true,
  availableFrom: true,
  availableUntil: true,
  timeLimitMinutes: true,
  maxAttempts: true,
  scoringPolicy: true,
  shuffleQuestions: true,
  shuffleOptions: true,
  oneQuestionPerPage: true,
  resultsVisibility: true,
  resultsReleasedAt: true,
  showCorrectAnswers: true,
} satisfies Prisma.QuizSelect;

/** Student path: never `correct`, `explanation` or `caseSensitive` (NFR-1). */
export const studentQuestionSelect = { id: true, type: true, prompt: true, points: true, options: true } satisfies Prisma.QuestionSelect;

const attemptInclude = {
  quiz: { select: quizSelect },
  student: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.QuizAttemptInclude;
type LoadedAttempt = Prisma.QuizAttemptGetPayload<{ include: typeof attemptInclude }>;

async function loadAttempt(id: string): Promise<LoadedAttempt> {
  const a = await prisma.quizAttempt.findUnique({ where: { id }, include: attemptInclude });
  if (!a) throw attemptNotFound();
  return a;
}

// ---------------------------------------------------------------------------
// Submit, grade, recompute (FR-17, FR-18, FR-25)
// ---------------------------------------------------------------------------

/** FR-25: score = Σ pointsAwarded; NEEDS_GRADING while anything needs review, else GRADED. Submitted attempts only. */
export async function recomputeAttempt(tx: Tx, attemptId: string) {
  const attempt = await tx.quizAttempt.findUnique({
    where: { id: attemptId },
    select: { status: true, answers: { select: { pointsAwarded: true, isCorrect: true, gradedById: true, question: { select: { type: true } } } } },
  });
  if (!attempt || attempt.status === 'IN_PROGRESS') return null;
  const score = attempt.answers.reduce((s, a) => s.plus(a.pointsAwarded ? dec(a.pointsAwarded) : 0), new Decimal(0));
  const status = attempt.answers.some((a) => needsReview(a.question, a)) ? 'NEEDS_GRADING' : 'GRADED';
  return tx.quizAttempt.update({ where: { id: attemptId }, data: { score: fixed2(score), status }, select: { id: true, status: true, score: true, maxScore: true } });
}

/** Re-grade every not-hand-graded answer of an attempt from the current questions. Returns changed count. */
export async function autoGradeAnswers(tx: Tx, attemptId: string, questionOrder: string[], { createMissing }: { createMissing: boolean }) {
  const [questions, answers] = await Promise.all([
    tx.question.findMany({ where: { id: { in: questionOrder } } }),
    tx.quizAnswer.findMany({ where: { attemptId } }),
  ]);
  const byQ = new Map(answers.map((a) => [a.questionId, a]));
  let changed = 0;
  for (const q of questions) {
    const a = byQ.get(q.id);
    if (a?.gradedById) continue; // a manual grade always wins (A8)
    if (!a && !createMissing) continue;
    const g = gradeAnswer(q, a?.response ?? null);
    const pointsAwarded = g.pointsAwarded === null ? null : fixed2(g.pointsAwarded);
    if (!a) {
      await tx.quizAnswer.create({ data: { attemptId, questionId: q.id, response: Prisma.DbNull, pointsAwarded, isCorrect: g.isCorrect } });
      continue;
    }
    const before = a.pointsAwarded === null ? null : fixed2(a.pointsAwarded);
    if (before === pointsAwarded && a.isCorrect === g.isCorrect) continue;
    changed++;
    await tx.quizAnswer.update({ where: { attemptId_questionId: { attemptId, questionId: q.id } }, data: { pointsAwarded, isCorrect: g.isCorrect } });
  }
  return changed;
}

/**
 * FR-17/FR-18: the one submit path. The IN_PROGRESS → SUBMITTED claim makes it idempotent and
 * race-safe. Returns true when this call did the submit.
 */
export async function submitAttempt(attemptId: string, { auto }: { auto: boolean }, now = new Date()): Promise<boolean> {
  const done = await prisma.$transaction(async (tx) => {
    const claimed = await tx.quizAttempt.updateMany({
      where: { id: attemptId, status: 'IN_PROGRESS' },
      data: { status: 'SUBMITTED', submittedAt: now, autoSubmitted: auto },
    });
    if (claimed.count === 0) return null;
    const { questionOrder, quizId, studentId } = await tx.quizAttempt.findUniqueOrThrow({ where: { id: attemptId }, select: { questionOrder: true, quizId: true, studentId: true } });
    await autoGradeAnswers(tx, attemptId, questionOrder, { createMissing: true });
    await recomputeAttempt(tx, attemptId);
    return { quizId, studentId };
  });
  if (!done) return false;
  await syncQuizGrade(done.quizId, done.studentId, now); // PRD-11 FR-7, after commit
  return true;
}

/** FR-18 lazy path: past deadlineAt + grace → auto-submit. Returns true if it submitted. */
export async function ensureNotExpired(attempt: { id: string; status: string; deadlineAt: Date | null }, now = new Date()): Promise<boolean> {
  if (attempt.status !== 'IN_PROGRESS' || !attempt.deadlineAt) return false;
  if (now.getTime() <= attempt.deadlineAt.getTime() + ANSWER_GRACE_MS) return false;
  return submitAttempt(attempt.id, { auto: true }, now);
}

/** Lazy sweep for one quiz (teacher grade/list loads). */
export async function ensureQuizAttemptsNotExpired(quizId: string, now = new Date()) {
  const expired = await prisma.quizAttempt.findMany({
    where: { quizId, status: 'IN_PROGRESS', deadlineAt: { lt: new Date(now.getTime() - ANSWER_GRACE_MS) } },
    select: { id: true },
  });
  for (const a of expired) await submitAttempt(a.id, { auto: true }, now);
}

// ---------------------------------------------------------------------------
// Start / resume (FR-12, FR-13, FR-19, FR-23, FR-28)
// ---------------------------------------------------------------------------

async function studentAttemptView(attemptId: string, now: Date) {
  const a = await prisma.quizAttempt.findUniqueOrThrow({
    where: { id: attemptId },
    include: { quiz: { select: quizSelect }, answers: { select: { questionId: true, response: true, updatedAt: true } } },
  });
  const questions = await prisma.question.findMany({ where: { id: { in: a.questionOrder } }, select: studentQuestionSelect });
  return toStudentAttempt(a, a.quiz, questions, a.answers, now);
}

export async function getAccommodation(quizId: string, studentId: string) {
  const row = await prisma.quizAccommodation.findUnique({ where: { quizId_studentId: { quizId, studentId } } });
  return { extraTimeMinutes: row?.extraTimeMinutes ?? 0, extraAttempts: row?.extraAttempts ?? 0 };
}

async function findInProgress(quizId: string, studentId: string) {
  return prisma.quizAttempt.findFirst({ where: { quizId, studentId, status: 'IN_PROGRESS' }, select: { id: true, status: true, deadlineAt: true } });
}

export async function startOrResumeAttempt(user: AccessUser, quizId: string, now = new Date()) {
  if (user.role !== 'STUDENT') throw quizNotFound();
  const quiz = await prisma.quiz.findUnique({ where: { id: quizId }, select: quizSelect });
  if (!quiz || quiz.status === 'DRAFT') throw quizNotFound();
  await viewCourseOrNotFound(user, quiz.courseId);

  const existing = await findInProgress(quizId, user.id);
  if (existing && !(await ensureNotExpired(existing, now))) {
    return { attempt: await studentAttemptView(existing.id, now), created: false };
  }
  if (!isOpen(quiz, now)) throw new AppError('CONFLICT', 'This quiz is not open.');

  const [acc, used, questions] = await Promise.all([
    getAccommodation(quizId, user.id),
    prisma.quizAttempt.count({ where: { quizId, studentId: user.id } }),
    prisma.question.findMany({ where: { quizId }, orderBy: { order: 'asc' }, select: { id: true, points: true } }),
  ]);
  if (used >= attemptLimit(quiz.maxAttempts, acc.extraAttempts)) {
    // FR-19: a second tab may have created the attempt between our check and the count.
    const raced = await findInProgress(quizId, user.id);
    if (raced) return { attempt: await studentAttemptView(raced.id, now), created: false };
    throw new AppError('CONFLICT', 'You have used all your attempts for this quiz.');
  }

  const id = newId();
  const ids = questions.map((q) => q.id);
  try {
    await prisma.quizAttempt.create({
      data: {
        id,
        quizId,
        studentId: user.id,
        attemptNumber: used + 1,
        startedAt: now,
        questionOrder: quiz.shuffleQuestions ? seededShuffle(ids, id) : ids,
        deadlineAt: computeDeadline(now, quiz.timeLimitMinutes, acc.extraTimeMinutes, quiz.availableUntil),
        maxScore: fixed2(questions.reduce((s, q) => s.plus(dec(q.points)), new Decimal(0))),
      },
    });
  } catch (error) {
    // FR-19: a second tab won the race (partial unique index or attemptNumber unique) → resume theirs.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const winner = await findInProgress(quizId, user.id);
      if (winner) return { attempt: await studentAttemptView(winner.id, now), created: false };
      throw new AppError('CONFLICT', 'Another attempt was just started. Please reload.');
    }
    throw error;
  }
  return { attempt: await studentAttemptView(id, now), created: true };
}

// ---------------------------------------------------------------------------
// Read (FR-18, FR-21, FR-24, FR-34)
// ---------------------------------------------------------------------------

/** Result payload for a submitted attempt. Loads correct/explanation only when they may be shown. */
async function studentResultView(a: LoadedAttempt, now: Date) {
  const showCorrect = resultsVisible(a.quiz, a, now) && a.quiz.showCorrectAnswers;
  const [questions, answers] = await Promise.all([
    prisma.question.findMany({
      where: { id: { in: a.questionOrder } },
      select: { ...studentQuestionSelect, ...(showCorrect ? { correct: true, explanation: true } : {}) },
    }),
    prisma.quizAnswer.findMany({ where: { attemptId: a.id } }),
  ]);
  return toStudentResult(a, a.quiz, questions, answers, now);
}

async function managerAttemptView(a: LoadedAttempt) {
  const [questions, answers] = await Promise.all([
    prisma.question.findMany({ where: { id: { in: a.questionOrder } } }),
    prisma.quizAnswer.findMany({ where: { attemptId: a.id } }),
  ]);
  return toManagerAttempt(a, questions, answers);
}

export type AttemptView =
  | { view: 'attempt'; data: Awaited<ReturnType<typeof studentAttemptView>> }
  | { view: 'result'; data: Awaited<ReturnType<typeof studentResultView>> }
  | { view: 'manager'; data: Awaited<ReturnType<typeof managerAttemptView>> };

export async function getAttemptView(user: AccessUser, attemptId: string, now = new Date()): Promise<AttemptView> {
  let a = await loadAttempt(attemptId);
  if (await ensureNotExpired(a, now)) a = await loadAttempt(attemptId);
  const viewer = await assertCanAccessAttempt(user, a, { now });
  if (viewer === 'MANAGER') return { view: 'manager', data: await managerAttemptView(a) };
  if (viewer === 'OWNER' && a.status === 'IN_PROGRESS') return { view: 'attempt', data: await studentAttemptView(a.id, now) };
  return { view: 'result', data: await studentResultView(a, now) };
}

/** GET /api/attempts/:id payload. */
export async function getAttempt(user: AccessUser, attemptId: string, now = new Date()) {
  return (await getAttemptView(user, attemptId, now)).data;
}

/** Grade workspace (FR-24): every submitted attempt of a quiz, after the lazy sweep. */
export async function listManagerAttempts(user: AccessUser, quizId: string, now = new Date()) {
  const quiz = await prisma.quiz.findUnique({ where: { id: quizId }, select: { courseId: true } });
  if (!quiz) throw quizNotFound();
  await manageCourseOrNotFound(user, quiz.courseId);
  await ensureQuizAttemptsNotExpired(quizId, now);
  const [attempts, questions] = await Promise.all([
    prisma.quizAttempt.findMany({
      where: { quizId, status: { not: 'IN_PROGRESS' } },
      include: { student: { select: { id: true, firstName: true, lastName: true } }, answers: true },
      orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }, { attemptNumber: 'asc' }],
    }),
    prisma.question.findMany({ where: { quizId }, orderBy: { order: 'asc' } }),
  ]);
  return attempts.map((a) => toManagerAttempt(a, questions, a.answers));
}

// ---------------------------------------------------------------------------
// Autosave hot path (FR-15, FR-16, NFR-2)
// ---------------------------------------------------------------------------

/** One attempt read + one upsert; no Quiz/Question load. Idempotent, so client replays are safe. */
export async function saveAnswer(user: AccessUser, attemptId: string, questionId: string, response: AnswerResponse | null, now = new Date()) {
  const a = await prisma.quizAttempt.findUnique({ where: { id: attemptId }, select: { studentId: true, status: true, deadlineAt: true, questionOrder: true } });
  if (!a || a.studentId !== user.id) throw attemptNotFound();
  if (!a.questionOrder.includes(questionId)) throw new AppError('NOT_FOUND', 'Question not found');
  if (a.status !== 'IN_PROGRESS') throw new AppError('CONFLICT', 'This attempt has already been submitted.');
  if (a.deadlineAt && now.getTime() > a.deadlineAt.getTime() + ANSWER_GRACE_MS) {
    await submitAttempt(attemptId, { auto: true }, now);
    throw new AppError('CONFLICT', 'Time is up');
  }
  // ponytail: an upsert racing the submit claim can land after grading (left ungraded); a Regrade fixes it.
  const json = response === null ? Prisma.DbNull : (response as Prisma.InputJsonValue);
  const row = await prisma.quizAnswer.upsert({
    where: { attemptId_questionId: { attemptId, questionId } },
    create: { attemptId, questionId, response: json },
    update: { response: json },
    select: { updatedAt: true },
  });
  return { questionId, savedAt: row.updatedAt.toISOString() };
}

/** POST /api/attempts/:id/submit — owner only; repeat calls return the current result. */
export async function submitForStudent(user: AccessUser, attemptId: string, now = new Date()) {
  const a = await loadAttempt(attemptId);
  if (a.studentId !== user.id || user.role !== 'STUDENT') throw attemptNotFound();
  await submitAttempt(attemptId, { auto: false }, now);
  return studentResultView(await loadAttempt(attemptId), now);
}

// ---------------------------------------------------------------------------
// Manual grading (FR-24, FR-25, FR-38)
// ---------------------------------------------------------------------------

export async function gradeAnswerManually(user: AccessUser, attemptId: string, questionId: string, input: ManualGradeInput, request?: Request) {
  const a = await loadAttempt(attemptId);
  await manageCourseOrNotFound(user, a.quiz.courseId, attemptNotFound);
  if (!a.questionOrder.includes(questionId)) throw new AppError('NOT_FOUND', 'Question not found');
  if (a.status === 'IN_PROGRESS') throw new AppError('CONFLICT', 'This attempt is still in progress.');
  const question: Pick<Question, 'points' | 'type'> | null = await prisma.question.findUnique({ where: { id: questionId }, select: { points: true, type: true } });
  if (!question) throw new AppError('NOT_FOUND', 'Question not found');
  if (dec(input.pointsAwarded).gt(dec(question.points))) {
    throw new AppError('VALIDATION_ERROR', `Points cannot exceed ${fixed2(question.points)}.`, { fieldErrors: { pointsAwarded: ['Too many points'] } });
  }

  const data = {
    pointsAwarded: input.pointsAwarded,
    isCorrect: dec(input.pointsAwarded).eq(dec(question.points)),
    gradedById: user.id,
    ...(input.feedback !== undefined ? { feedback: input.feedback || null } : {}),
  };
  const { answer, attempt } = await prisma.$transaction(async (tx) => {
    const answer = await tx.quizAnswer.upsert({
      where: { attemptId_questionId: { attemptId, questionId } },
      create: { attemptId, questionId, response: Prisma.DbNull, ...data },
      update: data,
    });
    const attempt = await recomputeAttempt(tx, attemptId);
    return { answer, attempt: attempt! };
  });
  await syncQuizGrade(a.quizId, a.studentId); // PRD-11 FR-7
  await audit({
    actorId: user.id,
    action: 'quizAnswer.grade',
    entityType: 'QuizAttempt',
    entityId: attemptId,
    metadata: { questionId, pointsAwarded: input.pointsAwarded, studentId: a.studentId },
    request,
  });
  return {
    answer: toManagerAnswer(answer, question),
    attempt: { id: attempt.id, status: attempt.status, score: attempt.score == null ? null : fixed2(attempt.score), maxScore: fixed2(attempt.maxScore) },
  };
}

// ---------------------------------------------------------------------------
// PRD-11 export (FR-22, FR-33) — no endpoint by design
// ---------------------------------------------------------------------------

export async function getStudentQuizScore(quizId: string, studentId: string) {
  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    select: {
      isPractice: true,
      scoringPolicy: true,
      attempts: { where: { studentId, status: 'GRADED' }, select: { score: true, maxScore: true, submittedAt: true } },
    },
  });
  if (!quiz) return null;
  const graded = quiz.attempts.filter((a) => a.score !== null && a.submittedAt !== null).map((a) => ({ score: a.score!, maxScore: a.maxScore, submittedAt: a.submittedAt! }));
  const result = applyScoringPolicy(quiz.scoringPolicy, graded);
  return result ? { ...result, isPractice: quiz.isPractice } : null;
}

/** Start screen "Your attempts" list: the caller's own submitted attempts (no grading data). */
export async function listOwnAttempts(user: AccessUser, quizId: string) {
  const rows = await prisma.quizAttempt.findMany({
    where: { quizId, studentId: user.id, status: { not: 'IN_PROGRESS' } },
    select: { id: true, attemptNumber: true, submittedAt: true },
    orderBy: { attemptNumber: 'asc' },
  });
  return rows.map((r) => ({ id: r.id, attemptNumber: r.attemptNumber, submittedAt: r.submittedAt?.toISOString() ?? null }));
}
