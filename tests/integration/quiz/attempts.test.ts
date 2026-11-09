// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DATABASE_URL ??= 'postgresql://unused@localhost/unused';
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.AUTH_SECRET ??= 'test-secret';
});

import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import { getAttemptView, getStudentQuizScore, saveAnswer, startOrResumeAttempt, submitAttempt, submitForStudent } from '@/server/quiz/attempt-service';
import { autoSubmitExpiredAttempts, sendAfterCloseResultsReleased } from '@/server/quiz/maintenance';

/**
 * PRD-10 attempt lifecycle against a real, migrated Postgres (NFR-8). Fixtures tagged with MARK and
 * removed afterwards. Skipped without TEST_DATABASE_URL.
 */
const MARK = 'qa-sh10-att';
const MIN = 60_000;
const ids = {} as Record<'year' | 'subject' | 'course' | 'teacher' | 's1' | 's2' | 's3' | 's4', string>;
const student = (id: string) => ({ id, role: 'STUDENT' as const });

async function code(p: Promise<unknown>) {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return e instanceof AppError ? e.code : (e as Error).message;
  }
}

async function mkQuiz(data: Partial<Prisma.QuizUncheckedCreateInput> = {}) {
  const now = Date.now();
  const quiz = await prisma.quiz.create({
    data: {
      courseId: ids.course,
      title: `${MARK} ${Math.random()}`,
      availableFrom: new Date(now - 60 * MIN),
      availableUntil: new Date(now + 60 * MIN),
      timeLimitMinutes: 10,
      resultsVisibility: 'IMMEDIATELY',
      status: 'PUBLISHED',
      createdById: ids.teacher,
      ...data,
    },
  });
  const opts = [{ id: 'A', text: 'A' }, { id: 'B', text: 'B' }];
  await prisma.question.createMany({
    data: [
      { quizId: quiz.id, type: 'SINGLE_CHOICE', prompt: 'One', points: '2', order: 0, options: opts, correct: { optionId: 'A' } },
      { quizId: quiz.id, type: 'TRUE_FALSE', prompt: 'Two', points: '1', order: 1, correct: { value: true } },
    ],
  });
  const questions = await prisma.question.findMany({ where: { quizId: quiz.id }, orderBy: { order: 'asc' } });
  return { quiz, questions };
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('quiz attempts (integration)', () => {
  beforeAll(async () => {
    const mk = (n: string, role: 'TEACHER' | 'STUDENT') =>
      prisma.user.create({ data: { email: `${n}@${MARK}.test`, firstName: 'QA', lastName: n, role, status: 'ACTIVE' } }).then((u) => u.id);
    Object.assign(ids, { teacher: await mk('teacher', 'TEACHER'), s1: await mk('s1', 'STUDENT'), s2: await mk('s2', 'STUDENT'), s3: await mk('s3', 'STUDENT'), s4: await mk('s4', 'STUDENT') });
    ids.year = (await prisma.academicYear.create({ data: { name: MARK, startDate: new Date('2026-01-01'), endDate: new Date('2027-12-31') } })).id;
    ids.subject = (await prisma.subject.create({ data: { name: MARK, code: MARK.toUpperCase() } })).id;
    ids.course = (await prisma.course.create({ data: { name: MARK, code: MARK, academicYearId: ids.year, subjectId: ids.subject, teacherId: ids.teacher } })).id;
    await prisma.enrollment.createMany({ data: [ids.s1, ids.s2, ids.s3, ids.s4].map((studentId) => ({ courseId: ids.course, studentId })) });
  });

  afterAll(async () => {
    const users = [ids.teacher, ids.s1, ids.s2, ids.s3, ids.s4].filter(Boolean);
    await prisma.course.deleteMany({ where: { code: MARK } });
    await prisma.notification.deleteMany({ where: { userId: { in: users } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.subject.deleteMany({ where: { code: MARK.toUpperCase() } });
    await prisma.academicYear.deleteMany({ where: { name: MARK } });
  });

  it('autosave within grace succeeds; after deadline + 30 s it is 409 and the attempt is auto-submitted (FR-16)', async () => {
    const { quiz, questions } = await mkQuiz();
    const t0 = new Date();
    const { attempt, created } = await startOrResumeAttempt(student(ids.s1), quiz.id, t0);
    expect(created).toBe(true);
    expect(new Date(attempt.deadlineAt).getTime()).toBe(t0.getTime() + 10 * MIN);
    expect(JSON.stringify(attempt)).not.toContain('correct');

    await saveAnswer(student(ids.s1), attempt.id, questions[0].id, { optionId: 'A' }, new Date(t0.getTime() + 10 * MIN + 20_000));
    expect(await code(saveAnswer(student(ids.s1), attempt.id, questions[1].id, { value: true }, new Date(t0.getTime() + 10 * MIN + 31_000)))).toBe('CONFLICT');

    const row = await prisma.quizAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(row).toMatchObject({ status: 'GRADED', autoSubmitted: true });
    expect(row.score?.toFixed(2)).toBe('2.00');
  });

  it('GET auto-submits an expired attempt with its saved answers (FR-18, AC-3)', async () => {
    const { quiz, questions } = await mkQuiz();
    const t0 = new Date();
    const { attempt } = await startOrResumeAttempt(student(ids.s2), quiz.id, t0);
    await saveAnswer(student(ids.s2), attempt.id, questions[1].id, { value: true }, t0);
    const view = await getAttemptView(student(ids.s2), attempt.id, new Date(t0.getTime() + 11 * MIN));
    expect(view.view).toBe('result');
    expect(view.data).toMatchObject({ autoSubmitted: true, status: 'GRADED', score: '1.00', maxScore: '3.00' });
  });

  it('resume returns the same attempt; concurrent starts produce one attempt (FR-19, AC-2)', async () => {
    const { quiz, questions } = await mkQuiz();
    const [a, b] = await Promise.all([startOrResumeAttempt(student(ids.s3), quiz.id), startOrResumeAttempt(student(ids.s3), quiz.id)]);
    expect(a.attempt.id).toBe(b.attempt.id);
    expect(await prisma.quizAttempt.count({ where: { quizId: quiz.id, studentId: ids.s3 } })).toBe(1);
    await saveAnswer(student(ids.s3), a.attempt.id, questions[0].id, { optionId: 'B' });
    const resumed = await startOrResumeAttempt(student(ids.s3), quiz.id);
    expect(resumed.created).toBe(false);
    expect(resumed.attempt.answers).toEqual([expect.objectContaining({ questionId: questions[0].id, response: { optionId: 'B' } })]);
  });

  it('double submit is a no-op; attempt limit and accommodation (FR-17, FR-23, AC-8)', async () => {
    const { quiz } = await mkQuiz({ maxAttempts: 1 });
    const { attempt } = await startOrResumeAttempt(student(ids.s4), quiz.id);
    expect(await submitAttempt(attempt.id, { auto: false })).toBe(true);
    expect(await submitAttempt(attempt.id, { auto: false })).toBe(false);
    const result = await submitForStudent(student(ids.s4), attempt.id);
    expect(result).toMatchObject({ status: 'GRADED', autoSubmitted: false, score: '0.00' });
    expect(await prisma.quizAnswer.count({ where: { attemptId: attempt.id } })).toBe(2);

    expect(await code(startOrResumeAttempt(student(ids.s4), quiz.id))).toBe('CONFLICT');
    await prisma.quizAccommodation.create({ data: { quizId: quiz.id, studentId: ids.s4, extraAttempts: 1 } });
    expect((await startOrResumeAttempt(student(ids.s4), quiz.id)).attempt.attemptNumber).toBe(2);
  });

  it('closed quiz is CONFLICT; other students and other roles get NOT_FOUND', async () => {
    const { quiz } = await mkQuiz({ availableUntil: new Date(Date.now() - MIN), availableFrom: new Date(Date.now() - 60 * MIN) });
    expect(await code(startOrResumeAttempt(student(ids.s1), quiz.id))).toBe('CONFLICT');
    const open = await mkQuiz();
    const { attempt } = await startOrResumeAttempt(student(ids.s1), open.quiz.id);
    expect(await code(getAttemptView(student(ids.s2), attempt.id))).toBe('NOT_FOUND');
    expect(await code(saveAnswer(student(ids.s2), attempt.id, open.questions[0].id, { optionId: 'A' }))).toBe('NOT_FOUND');
    expect(await code(startOrResumeAttempt({ id: ids.teacher, role: 'TEACHER' }, open.quiz.id))).toBe('NOT_FOUND');
  });

  it('maintenance auto-submit and AFTER_CLOSE release are idempotent under concurrent runs (FR-18, FR-30, FR-35)', async () => {
    const { quiz } = await mkQuiz({ resultsVisibility: 'AFTER_CLOSE' });
    const t0 = new Date(Date.now() - 20 * MIN);
    const { attempt } = await startOrResumeAttempt(student(ids.s2), quiz.id, t0);
    await Promise.all([autoSubmitExpiredAttempts(), autoSubmitExpiredAttempts()]);
    expect(await prisma.quizAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).toMatchObject({ status: 'GRADED', autoSubmitted: true });

    await prisma.quiz.update({ where: { id: quiz.id }, data: { availableUntil: new Date(Date.now() - MIN) } });
    await Promise.all([sendAfterCloseResultsReleased(), sendAfterCloseResultsReleased()]);
    expect(await prisma.notification.count({ where: { userId: ids.s2, type: 'quiz.results_released', link: { contains: quiz.id } } })).toBe(1);
    expect((await prisma.quiz.findUniqueOrThrow({ where: { id: quiz.id } })).resultsReleasedAt).not.toBeNull();
  });

  it('getStudentQuizScore uses the policy over GRADED attempts and reports isPractice (FR-22, FR-33)', async () => {
    const { quiz } = await mkQuiz({ isPractice: true, maxAttempts: 2 });
    const { attempt } = await startOrResumeAttempt(student(ids.s1), quiz.id);
    await submitAttempt(attempt.id, { auto: false });
    expect(await getStudentQuizScore(quiz.id, ids.s1)).toMatchObject({ score: '0.00', maxScore: '3.00', percent: 0, isPractice: true, attemptsCounted: 1 });
  });
});
