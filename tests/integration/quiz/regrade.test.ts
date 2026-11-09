// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DATABASE_URL ??= 'postgresql://unused@localhost/unused';
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.AUTH_SECRET ??= 'test-secret';
});

import { prisma } from '@/server/db';
import { AppError } from '@/server/http';
import { gradeAnswerManually, saveAnswer, startOrResumeAttempt, submitForStudent } from '@/server/quiz/attempt-service';
import { addQuestion, deleteQuestion, deleteQuiz, regradeQuiz, releaseResults, updateQuestion, updateQuiz } from '@/server/quiz/quiz-service';

/**
 * PRD-10 edit lock, regrade, manual grading and release (FR-10, FR-24, FR-25, FR-20) on real Postgres.
 * Skipped without TEST_DATABASE_URL.
 */
const MARK = 'qa-sh10-rgd';
const MIN = 60_000;
const ids = {} as Record<'year' | 'subject' | 'course' | 'teacher' | 's1' | 's2' | 'parent', string>;
const teacher = () => ({ id: ids.teacher, role: 'TEACHER' as const });
const student = (id: string) => ({ id, role: 'STUDENT' as const });

async function code(p: Promise<unknown>) {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return e instanceof AppError ? e.code : (e as Error).message;
  }
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('quiz regrade and grading (integration)', () => {
  beforeAll(async () => {
    const mk = (n: string, role: 'TEACHER' | 'STUDENT' | 'PARENT') =>
      prisma.user.create({ data: { email: `${n}@${MARK}.test`, firstName: 'QA', lastName: n, role, status: 'ACTIVE' } }).then((u) => u.id);
    Object.assign(ids, { teacher: await mk('teacher', 'TEACHER'), s1: await mk('s1', 'STUDENT'), s2: await mk('s2', 'STUDENT'), parent: await mk('parent', 'PARENT') });
    await prisma.parentStudentLink.create({ data: { parentId: ids.parent, studentId: ids.s1, relationship: 'MOTHER' } });
    ids.year = (await prisma.academicYear.create({ data: { name: MARK, startDate: new Date('2026-01-01'), endDate: new Date('2027-12-31') } })).id;
    ids.subject = (await prisma.subject.create({ data: { name: MARK, code: MARK.toUpperCase() } })).id;
    ids.course = (await prisma.course.create({ data: { name: MARK, code: MARK, academicYearId: ids.year, subjectId: ids.subject, teacherId: ids.teacher } })).id;
    await prisma.enrollment.createMany({ data: [ids.s1, ids.s2].map((studentId) => ({ courseId: ids.course, studentId })) });
  });

  afterAll(async () => {
    const users = [ids.teacher, ids.s1, ids.s2, ids.parent].filter(Boolean);
    await prisma.course.deleteMany({ where: { code: MARK } });
    await prisma.notification.deleteMany({ where: { userId: { in: users } } });
    await prisma.emailOutbox.deleteMany({ where: { toEmail: { endsWith: `@${MARK}.test` } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.subject.deleteMany({ where: { code: MARK.toUpperCase() } });
    await prisma.academicYear.deleteMany({ where: { name: MARK } });
  });

  it('publish check, edit lock, regrade keeps manual grades, essay grading → GRADED, manual release', async () => {
    const now = Date.now();
    const quiz = await prisma.quiz.create({
      data: {
        courseId: ids.course,
        title: `${MARK} quiz`,
        availableFrom: new Date(now - 10 * MIN),
        availableUntil: new Date(now + 60 * MIN),
        resultsVisibility: 'MANUAL',
        createdById: ids.teacher,
      },
    });
    expect(await code(updateQuiz(teacher(), quiz.id, { status: 'PUBLISHED' }))).toBe('VALIDATION_ERROR');

    const short = await addQuestion(teacher(), quiz.id, { type: 'SHORT_ANSWER', prompt: 'Animal?', points: '2.00', correct: { accepted: ['cat'] }, explanation: null, caseSensitive: false });
    const essay = await addQuestion(teacher(), quiz.id, { type: 'ESSAY', prompt: 'Explain', points: '5.00', correct: { guidance: 'secret' }, explanation: null, caseSensitive: false });
    const published = await updateQuiz(teacher(), quiz.id, { status: 'PUBLISHED' });
    expect(published).toMatchObject({ status: 'PUBLISHED', totalPoints: '7.00', locked: false });
    expect(await prisma.notification.count({ where: { userId: ids.s1, type: 'quiz.published' } })).toBe(1);
    expect(await code(updateQuiz(teacher(), quiz.id, { status: 'PUBLISHED' }))).toBe('CONFLICT');

    const results: Record<string, string> = {};
    for (const s of [ids.s1, ids.s2]) {
      const { attempt } = await startOrResumeAttempt(student(s), quiz.id);
      await saveAnswer(student(s), attempt.id, short.id, { text: 'Dog' });
      await saveAnswer(student(s), attempt.id, essay.id, { text: 'Because.' });
      const r = await submitForStudent(student(s), attempt.id);
      expect(r).toMatchObject({ status: 'NEEDS_GRADING', resultsVisible: false, score: null, questions: null }); // AC-6, AC-7
      results[s] = attempt.id;
    }

    // Edit lock (FR-10, AC-9)
    expect(await code(deleteQuestion(teacher(), short.id))).toBe('CONFLICT');
    expect(await code(updateQuestion(teacher(), short.id, { points: 3 }))).toBe('CONFLICT');
    expect(await code(updateQuestion(teacher(), essay.id, { correct: { guidance: 'x' } }))).toBe('CONFLICT');
    expect(await code(addQuestion(teacher(), quiz.id, { type: 'TRUE_FALSE', prompt: 'x', points: '1.00', correct: { value: true }, explanation: null, caseSensitive: false }))).toBe('CONFLICT');
    expect(await code(deleteQuiz(teacher(), quiz.id))).toBe('CONFLICT');

    // s2's short answer is overridden by hand; then "dog" becomes accepted and we regrade.
    await gradeAnswerManually(teacher(), results[ids.s2], short.id, { pointsAwarded: '1.00', feedback: 'Half' });
    expect(await code(gradeAnswerManually(teacher(), results[ids.s2], short.id, { pointsAwarded: '2.50' }))).toBe('VALIDATION_ERROR');
    await updateQuestion(teacher(), short.id, { ...short, points: short.points, correct: { accepted: ['cat', 'dog'] } });
    const rg = await regradeQuiz(teacher(), quiz.id);
    expect(rg).toEqual({ attemptCount: 2, changedAnswerCount: 1 });
    const a1 = await prisma.quizAnswer.findUniqueOrThrow({ where: { attemptId_questionId: { attemptId: results[ids.s1], questionId: short.id } } });
    const a2 = await prisma.quizAnswer.findUniqueOrThrow({ where: { attemptId_questionId: { attemptId: results[ids.s2], questionId: short.id } } });
    expect([a1.pointsAwarded?.toFixed(2), a1.isCorrect]).toEqual(['2.00', true]);
    expect([a2.pointsAwarded?.toFixed(2), a2.feedback]).toEqual(['1.00', 'Half']);

    // Essay grade → GRADED with the recomputed score (FR-25)
    const g = await gradeAnswerManually(teacher(), results[ids.s1], essay.id, { pointsAwarded: '4.50', feedback: 'Good' });
    expect(g.attempt).toMatchObject({ status: 'GRADED', score: '6.50', maxScore: '7.00' });

    // MANUAL release: once, idempotent (FR-20, FR-30)
    const rel = await releaseResults(teacher(), quiz.id);
    expect(rel.notified).toBe(true);
    expect((await releaseResults(teacher(), quiz.id)).notified).toBe(false);
    expect(await prisma.notification.count({ where: { userId: { in: [ids.s1, ids.s2, ids.parent] }, type: 'quiz.results_released' } })).toBe(3);
  });
});
