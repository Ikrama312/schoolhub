import { describe, expect, it } from 'vitest';
import { toStudentAttempt, toStudentQuiz, toStudentResult, type AnswerRow, type AttemptRow, type QuestionRow, type QuizRow } from '@/server/quiz/serializers';
import { seededShuffle } from '@/server/quiz/grading';

const now = new Date('2026-11-10T10:00:00Z');
const quiz: QuizRow = {
  id: 'q1',
  courseId: 'c1',
  title: 'Fractions',
  instructions: '',
  isPractice: false,
  status: 'PUBLISHED',
  availableFrom: new Date('2026-11-10T09:00:00Z'),
  availableUntil: new Date('2026-11-10T11:00:00Z'),
  timeLimitMinutes: 20,
  maxAttempts: 2,
  oneQuestionPerPage: false,
  shuffleOptions: true,
  resultsVisibility: 'AFTER_CLOSE',
  resultsReleasedAt: null,
  showCorrectAnswers: true,
};
const opts = ['A', 'B', 'C', 'D', 'E', 'F'].map((id) => ({ id, text: id }));
const questions: QuestionRow[] = [
  { id: 'x1', type: 'SINGLE_CHOICE', prompt: 'p1', points: '2', options: opts, correct: { optionId: 'A' }, explanation: 'because' },
  { id: 'x2', type: 'ESSAY', prompt: 'p2', points: '5', options: null, correct: { guidance: 'secret rubric' }, explanation: null },
];
const attempt: AttemptRow = {
  id: 'att-1',
  quizId: 'q1',
  attemptNumber: 1,
  status: 'GRADED',
  startedAt: new Date('2026-11-10T09:30:00Z'),
  deadlineAt: new Date('2026-11-10T09:50:00Z'),
  submittedAt: new Date('2026-11-10T09:45:00Z'),
  autoSubmitted: false,
  questionOrder: ['x2', 'x1'],
  score: '6',
  maxScore: '7',
};
const answers: AnswerRow[] = [
  { questionId: 'x1', response: { optionId: 'A' }, pointsAwarded: '2', isCorrect: true, feedback: null, gradedById: null, updatedAt: now },
  { questionId: 'x2', response: { text: 'essay' }, pointsAwarded: '4', isCorrect: false, feedback: 'Good', gradedById: 't1', updatedAt: now },
];

/** Recursively collect every key in a JSON value. */
function keys(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keys(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (out.add(k), keys(x, out));
  return out;
}

describe('student serializers (NFR-1, AC-7)', () => {
  it('toStudentQuiz carries no questions or correct answers', () => {
    const r = toStudentQuiz(quiz, questions, { now, extraTimeMinutes: 0, extraAttempts: 1, attemptsUsed: 1, inProgressAttemptId: null });
    expect(keys(r).has('correct')).toBe(false);
    expect(keys(r).has('questions')).toBe(false);
    expect(r).toMatchObject({ questionCount: 2, totalPoints: '7.00', attemptLimit: 3, isOpen: true });
  });

  it('toStudentAttempt: no correct/explanation/caseSensitive; frozen order; seeded option shuffle', () => {
    const r = toStudentAttempt({ ...attempt, status: 'IN_PROGRESS' }, quiz, questions, [answers[0]], now);
    const k = keys(r);
    for (const banned of ['correct', 'explanation', 'caseSensitive', 'pointsAwarded', 'isCorrect', 'score']) expect(k.has(banned)).toBe(false);
    expect(r.questions.map((q) => q.id)).toEqual(['x2', 'x1']);
    expect(r.questions[1].options).toEqual(seededShuffle(opts, 'att-1'));
    expect(r.serverNow).toBe(now.toISOString());
  });

  it('toStudentResult before AFTER_CLOSE: no correct key, no scores (AC-7)', () => {
    const r = toStudentResult(attempt, quiz, questions, answers, now);
    expect(keys(r).has('correct')).toBe(false);
    expect(keys(r).has('explanation')).toBe(false);
    expect(r).toMatchObject({ resultsVisible: false, score: null, percent: null, questions: null, maxScore: '7.00' });
  });

  it('after close: score, percent, correct + explanation when showCorrectAnswers', () => {
    const r = toStudentResult(attempt, quiz, questions, answers, quiz.availableUntil);
    expect(r).toMatchObject({ resultsVisible: true, score: '6.00', percent: 85.7 });
    expect(r.questions?.[1]).toMatchObject({ id: 'x1', correct: { optionId: 'A' }, explanation: 'because', pointsAwarded: '2.00' });
    expect(r.questions?.[0]).toMatchObject({ id: 'x2', feedback: 'Good', pendingReview: false });
  });

  it('visible but showCorrectAnswers = false: still no correct key', () => {
    const r = toStudentResult(attempt, { ...quiz, showCorrectAnswers: false }, questions, answers, quiz.availableUntil);
    expect(keys(r).has('correct')).toBe(false);
    expect(keys(r).has('explanation')).toBe(false);
  });

  it('NEEDS_GRADING: no final score; pending essay has null points', () => {
    const pending = [answers[0], { ...answers[1], gradedById: null, pointsAwarded: null, isCorrect: null }];
    const r = toStudentResult({ ...attempt, status: 'NEEDS_GRADING' }, { ...quiz, resultsVisibility: 'IMMEDIATELY' }, questions, pending, now);
    expect(r).toMatchObject({ awaitingGrading: true, score: null, percent: null });
    expect(r.questions?.[0]).toMatchObject({ pendingReview: true, pointsAwarded: null });
  });
});
