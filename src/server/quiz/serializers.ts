// Pure (NFR-1, ADR-5): the ONLY producers of quiz/attempt/result payloads for STUDENT and PARENT
// callers. Every object is built field by field from an allow-list — never spread-then-delete.
import { Decimal, dec, fixed2, type DecimalValue } from '@/server/assignments/grading-math';
import {
  attemptLimit,
  needsReview,
  percentOf,
  resultsVisible,
  seededShuffle,
  type AttemptState,
  type QType,
  type Visibility,
} from './grading';

type Option = { id: string; text: string };

export interface QuizRow {
  id: string;
  courseId: string;
  title: string;
  instructions: string;
  isPractice: boolean;
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED';
  availableFrom: Date;
  availableUntil: Date;
  timeLimitMinutes: number | null;
  maxAttempts: number;
  oneQuestionPerPage: boolean;
  shuffleOptions: boolean;
  resultsVisibility: Visibility;
  resultsReleasedAt: Date | null;
  showCorrectAnswers: boolean;
}

export interface QuestionRow {
  id: string;
  type: QType;
  prompt: string;
  points: DecimalValue;
  options: unknown;
  /** Only loaded on the result path when correct answers may be shown. */
  correct?: unknown;
  explanation?: string | null;
}

export interface AttemptRow {
  id: string;
  quizId: string;
  attemptNumber: number;
  status: AttemptState;
  startedAt: Date;
  deadlineAt: Date | null;
  submittedAt: Date | null;
  autoSubmitted: boolean;
  questionOrder: string[];
  score: DecimalValue | null;
  maxScore: DecimalValue;
}

export interface AnswerRow {
  questionId: string;
  response: unknown;
  pointsAwarded: DecimalValue | null;
  isCorrect: boolean | null;
  feedback: string | null;
  gradedById: string | null;
  updatedAt: Date;
}

export interface StudentContext {
  now: Date;
  extraTimeMinutes: number;
  extraAttempts: number;
  attemptsUsed: number;
  inProgressAttemptId: string | null;
}

const iso = (d: Date) => d.toISOString();

/** Σ points as "12.50" (FR-8). */
export const totalPoints = (qs: readonly { points: DecimalValue }[]) => fixed2(qs.reduce((s, q) => s.plus(dec(q.points)), new Decimal(0)));
const sum = totalPoints;

export function isOpen(quiz: Pick<QuizRow, 'status' | 'availableFrom' | 'availableUntil'>, now: Date): boolean {
  return quiz.status === 'PUBLISHED' && quiz.availableFrom <= now && now < quiz.availableUntil;
}

function options(raw: unknown, shuffle: boolean, seed: string): Option[] | null {
  if (!Array.isArray(raw)) return null;
  const list = raw.map((o: { id: unknown; text: unknown }) => ({ id: String(o.id), text: String(o.text) }));
  return shuffle ? seededShuffle(list, seed) : list;
}

function ordered<T extends { id: string }>(items: readonly T[], order: readonly string[]): T[] {
  const byId = new Map(items.map((q) => [q.id, q]));
  return order.map((id) => byId.get(id)).filter((q): q is T => q !== undefined);
}

/** Start screen (FR-12). No questions, never `correct`. */
export function toStudentQuiz(quiz: QuizRow, questions: readonly { points: DecimalValue }[], ctx: StudentContext) {
  return {
    id: quiz.id,
    courseId: quiz.courseId,
    title: quiz.title,
    instructions: quiz.instructions,
    isPractice: quiz.isPractice,
    status: quiz.status,
    availableFrom: iso(quiz.availableFrom),
    availableUntil: iso(quiz.availableUntil),
    timeLimitMinutes: quiz.timeLimitMinutes,
    oneQuestionPerPage: quiz.oneQuestionPerPage,
    resultsVisibility: quiz.resultsVisibility,
    questionCount: questions.length,
    totalPoints: sum(questions),
    extraTimeMinutes: ctx.extraTimeMinutes,
    attemptLimit: attemptLimit(quiz.maxAttempts, ctx.extraAttempts),
    attemptsUsed: ctx.attemptsUsed,
    inProgressAttemptId: ctx.inProgressAttemptId,
    isOpen: isOpen(quiz, ctx.now),
  };
}
export type StudentQuiz = ReturnType<typeof toStudentQuiz>;

/** The player payload while IN_PROGRESS (FR-13, FR-14, FR-19). No grading fields. */
export function toStudentAttempt(
  attempt: AttemptRow,
  quiz: Pick<QuizRow, 'title' | 'oneQuestionPerPage' | 'shuffleOptions' | 'availableUntil'>,
  questions: readonly QuestionRow[],
  answers: readonly Pick<AnswerRow, 'questionId' | 'response' | 'updatedAt'>[],
  now: Date,
) {
  return {
    id: attempt.id,
    quizId: attempt.quizId,
    quizTitle: quiz.title,
    attemptNumber: attempt.attemptNumber,
    status: 'IN_PROGRESS' as const,
    startedAt: iso(attempt.startedAt),
    deadlineAt: iso(attempt.deadlineAt ?? quiz.availableUntil),
    serverNow: iso(now),
    oneQuestionPerPage: quiz.oneQuestionPerPage,
    questions: ordered(questions, attempt.questionOrder).map((q) => ({
      id: q.id,
      type: q.type,
      prompt: q.prompt,
      points: fixed2(q.points),
      options: options(q.options, quiz.shuffleOptions, attempt.id),
    })),
    answers: answers.map((a) => ({ questionId: a.questionId, response: (a.response ?? null) as unknown, savedAt: iso(a.updatedAt) })),
  };
}
export type StudentAttempt = ReturnType<typeof toStudentAttempt>;

/** Result for a submitted attempt (FR-20, FR-21). Nothing graded leaks unless resultsVisible. */
export function toStudentResult(
  attempt: AttemptRow,
  quiz: Pick<QuizRow, 'title' | 'shuffleOptions' | 'resultsVisibility' | 'availableUntil' | 'resultsReleasedAt' | 'showCorrectAnswers'>,
  questions: readonly QuestionRow[],
  answers: readonly AnswerRow[],
  now: Date,
) {
  const visible = resultsVisible(quiz, attempt, now);
  const graded = visible && attempt.status === 'GRADED' && attempt.score != null;
  const showCorrect = visible && quiz.showCorrectAnswers;
  const byQ = new Map(answers.map((a) => [a.questionId, a]));

  return {
    id: attempt.id,
    quizId: attempt.quizId,
    quizTitle: quiz.title,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status as Exclude<AttemptState, 'IN_PROGRESS'>,
    startedAt: iso(attempt.startedAt),
    submittedAt: iso(attempt.submittedAt ?? attempt.startedAt),
    autoSubmitted: attempt.autoSubmitted,
    resultsVisible: visible,
    awaitingGrading: attempt.status !== 'GRADED',
    score: graded ? fixed2(attempt.score!) : null,
    maxScore: fixed2(attempt.maxScore),
    percent: graded ? percentOf(attempt.score!, attempt.maxScore) : null,
    questions: visible
      ? ordered(questions, attempt.questionOrder).map((q) => {
          const a = byQ.get(q.id);
          const pending = a ? needsReview(q, a) : q.type === 'ESSAY';
          const item = {
            id: q.id,
            type: q.type,
            prompt: q.prompt,
            points: fixed2(q.points),
            options: options(q.options, quiz.shuffleOptions, attempt.id),
            response: (a?.response ?? null) as unknown,
            pendingReview: pending,
            pointsAwarded: !pending && a?.pointsAwarded != null ? fixed2(a.pointsAwarded) : null,
            isCorrect: pending ? null : a?.isCorrect ?? null,
            feedback: a?.feedback ?? null,
          };
          return showCorrect ? { ...item, correct: q.correct as unknown, explanation: q.explanation ?? null } : item;
        })
      : null,
  };
}
export type StudentResult = ReturnType<typeof toStudentResult>;

// ---------------------------------------------------------------------------
// Manager payloads (course managers only — never routed to STUDENT/PARENT).
// ---------------------------------------------------------------------------

export interface ManagerQuestionRow extends QuestionRow {
  quizId: string;
  order: number;
  correct: unknown;
  explanation: string | null;
  caseSensitive: boolean;
}

export function toManagerQuestion(q: ManagerQuestionRow) {
  return {
    id: q.id,
    quizId: q.quizId,
    type: q.type,
    prompt: q.prompt,
    points: fixed2(q.points),
    order: q.order,
    options: options(q.options, false, ''),
    correct: q.correct,
    explanation: q.explanation,
    caseSensitive: q.caseSensitive,
  };
}
export type ManagerQuestion = ReturnType<typeof toManagerQuestion>;

export function toManagerAnswer(a: AnswerRow, q: { type: QType } | undefined) {
  return {
    questionId: a.questionId,
    response: (a.response ?? null) as unknown,
    pointsAwarded: a.pointsAwarded == null ? null : fixed2(a.pointsAwarded),
    isCorrect: a.isCorrect,
    feedback: a.feedback,
    gradedById: a.gradedById,
    needsReview: q ? needsReview(q, a) : false,
    updatedAt: iso(a.updatedAt),
  };
}
export type ManagerAnswer = ReturnType<typeof toManagerAnswer>;

export function toManagerAttempt(
  attempt: AttemptRow & { student: { id: string; firstName: string; lastName: string } },
  questions: readonly ManagerQuestionRow[],
  answers: readonly AnswerRow[],
) {
  const qs = ordered(questions, attempt.questionOrder);
  const byId = new Map(qs.map((q) => [q.id, q]));
  return {
    id: attempt.id,
    quizId: attempt.quizId,
    student: { id: attempt.student.id, name: `${attempt.student.firstName} ${attempt.student.lastName}` },
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    startedAt: iso(attempt.startedAt),
    deadlineAt: attempt.deadlineAt ? iso(attempt.deadlineAt) : null,
    submittedAt: attempt.submittedAt ? iso(attempt.submittedAt) : null,
    autoSubmitted: attempt.autoSubmitted,
    score: attempt.score == null ? null : fixed2(attempt.score),
    maxScore: fixed2(attempt.maxScore),
    questionOrder: attempt.questionOrder,
    questions: qs.map(toManagerQuestion),
    answers: answers.map((a) => toManagerAnswer(a, byId.get(a.questionId))),
  };
}
export type ManagerAttempt = ReturnType<typeof toManagerAttempt>;
