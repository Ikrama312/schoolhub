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
import { quizSettingsSchema } from '@/lib/validators/quiz';
import { getAttemptView, gradeAnswerManually, saveAnswer, startOrResumeAttempt, submitForStudent } from '@/server/quiz/attempt-service';
import {
  addQuestion,
  createQuiz,
  deleteQuiz,
  getQuiz,
  listCourseQuizzes,
  regradeQuiz,
  releaseResults,
  reorderQuestions,
  updateQuiz,
  upsertAccommodation,
} from '@/server/quiz/quiz-service';
import { analyticsCsv, getQuizAnalytics, histogram } from '@/server/quiz/analytics';

/**
 * SH-10 QA: gaps not covered by dev's tests — student payload leak (NFR-1), role-shaped list (FR-11),
 * analytics + CSV (FR-26/27), access control (FR-34/NFR-5), audit rows (FR-38), accommodations (FR-28),
 * delete/reorder (FR-31). Real Postgres; skipped without TEST_DATABASE_URL.
 */
const MARK = 'qa-sh10-qa';
const MIN = 60_000;
const ids = {} as Record<'year' | 'subject' | 'course' | 'teacher' | 'teacher2' | 's1' | 's2' | 'outsider' | 'parent' | 'parent2', string>;
const as = (id: string, role: 'TEACHER' | 'STUDENT' | 'PARENT') => ({ id, role });
const teacher = () => as(ids.teacher, 'TEACHER');
const page = { page: 1, pageSize: 50, skip: 0, take: 50 };

async function code(p: Promise<unknown>) {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return e instanceof AppError ? e.code : (e as Error).message;
  }
}

const settings = (over: Record<string, unknown> = {}) =>
  quizSettingsSchema.parse({
    title: `${MARK} ${Math.random()}`,
    availableFrom: new Date(Date.now() - 10 * MIN),
    availableUntil: new Date(Date.now() + 60 * MIN),
    timeLimitMinutes: 20,
    ...over,
  });

const opts = [
  { id: 'A', text: 'Alpha' },
  { id: 'B', text: 'Bravo' },
  { id: 'C', text: 'Charlie' },
];

/** Published quiz with SINGLE_CHOICE (2 pts, A) + MULTIPLE_CHOICE (4 pts, A,C). */
async function publishedQuiz(over: Record<string, unknown> = {}) {
  const quiz = await createQuiz(teacher(), ids.course, settings(over));
  const sc = await addQuestion(teacher(), quiz.id, { type: 'SINGLE_CHOICE', prompt: 'Pick A', points: '2.00', options: opts, correct: { optionId: 'A' }, explanation: 'SECRET-EXPL', caseSensitive: false });
  const mc = await addQuestion(teacher(), quiz.id, { type: 'MULTIPLE_CHOICE', prompt: 'Pick A and C', points: '4.00', options: opts, correct: { optionIds: ['A', 'C'] }, explanation: null, caseSensitive: false });
  await updateQuiz(teacher(), quiz.id, { status: 'PUBLISHED' });
  return { quiz, sc, mc };
}

async function take(studentId: string, quizId: string, answers: Record<string, unknown>) {
  const { attempt } = await startOrResumeAttempt(as(studentId, 'STUDENT'), quizId);
  for (const [qid, r] of Object.entries(answers)) await saveAnswer(as(studentId, 'STUDENT'), attempt.id, qid, r as never);
  await submitForStudent(as(studentId, 'STUDENT'), attempt.id);
  return attempt.id;
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('quiz QA SH-10 (integration)', () => {
  beforeAll(async () => {
    const mk = (n: string, role: 'TEACHER' | 'STUDENT' | 'PARENT') =>
      prisma.user.create({ data: { email: `${n}@${MARK}.test`, firstName: 'QA', lastName: n, role, status: 'ACTIVE' } }).then((u) => u.id);
    for (const [k, r] of [['teacher', 'TEACHER'], ['teacher2', 'TEACHER'], ['s1', 'STUDENT'], ['s2', 'STUDENT'], ['outsider', 'STUDENT'], ['parent', 'PARENT'], ['parent2', 'PARENT']] as const) {
      ids[k] = await mk(k, r);
    }
    await prisma.parentStudentLink.create({ data: { parentId: ids.parent, studentId: ids.s1, relationship: 'MOTHER' } });
    ids.year = (await prisma.academicYear.create({ data: { name: MARK, startDate: new Date('2026-01-01'), endDate: new Date('2027-12-31') } })).id;
    ids.subject = (await prisma.subject.create({ data: { name: MARK, code: MARK.toUpperCase() } })).id;
    ids.course = (await prisma.course.create({ data: { name: MARK, code: MARK, academicYearId: ids.year, subjectId: ids.subject, teacherId: ids.teacher } })).id;
    await prisma.enrollment.createMany({ data: [ids.s1, ids.s2].map((studentId) => ({ courseId: ids.course, studentId })) });
  });

  afterAll(async () => {
    const users = Object.entries(ids).filter(([k]) => !['year', 'subject', 'course'].includes(k)).map(([, v]) => v);
    await prisma.course.deleteMany({ where: { code: MARK } });
    await prisma.notification.deleteMany({ where: { userId: { in: users } } });
    await prisma.emailOutbox.deleteMany({ where: { toEmail: { endsWith: `@${MARK}.test` } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.subject.deleteMany({ where: { code: MARK.toUpperCase() } });
    await prisma.academicYear.deleteMany({ where: { name: MARK } });
  });

  it('NFR-1: student GET quiz and in-progress attempt never contain correct/explanation; manager GET does', async () => {
    const { quiz } = await publishedQuiz({ resultsVisibility: 'MANUAL', showCorrectAnswers: true });
    const studentQuiz = JSON.stringify(await getQuiz(as(ids.s1, 'STUDENT'), quiz.id));
    expect(studentQuiz).not.toMatch(/"correct"|"explanation"|SECRET-EXPL/);

    const { attempt } = await startOrResumeAttempt(as(ids.s1, 'STUDENT'), quiz.id);
    expect(JSON.stringify(attempt)).not.toMatch(/"correct"|"explanation"|SECRET-EXPL/);
    const result = await submitForStudent(as(ids.s1, 'STUDENT'), attempt.id);
    expect(JSON.stringify(result)).not.toMatch(/"correct"|SECRET-EXPL/); // MANUAL, not released yet

    expect(JSON.stringify(await getQuiz(teacher(), quiz.id))).toContain('SECRET-EXPL');
  });

  it('FR-11/FR-31: course list is role-shaped; drafts hidden from students; outsiders get NOT_FOUND', async () => {
    const draft = await createQuiz(teacher(), ids.course, settings());
    const mgr = await listCourseQuizzes(teacher(), ids.course, page);
    expect(mgr.role).toBe('MANAGER');
    expect(mgr.items.some((i) => 'id' in i && i.id === draft.id)).toBe(true);
    expect(mgr.items[0]).toHaveProperty('needsGradingCount');

    const stu = await listCourseQuizzes(as(ids.s2, 'STUDENT'), ids.course, page);
    expect(stu.role).toBe('STUDENT');
    expect(stu.items.some((i) => 'quiz' in i && i.quiz.id === draft.id)).toBe(false);
    expect(stu.items.every((i) => 'group' in i && ['UPCOMING', 'AVAILABLE', 'COMPLETED', 'MISSED'].includes(i.group))).toBe(true);

    const par = await listCourseQuizzes(as(ids.parent, 'PARENT'), ids.course, page);
    expect(par.role).toBe('PARENT');
    expect(JSON.stringify(par)).not.toMatch(/"correct"/);

    expect(await code(listCourseQuizzes(as(ids.outsider, 'STUDENT'), ids.course, page))).toBe('NOT_FOUND');
    expect(await code(listCourseQuizzes(as(ids.teacher2, 'TEACHER'), ids.course, page))).toBe('NOT_FOUND');

    // FR-31: delete only without attempts
    expect(await code(deleteQuiz(teacher(), draft.id))).toBe('OK');
  });

  it('FR-26/FR-27: analytics summary, histogram, option distribution, most-chosen wrong option, CSV', async () => {
    const { quiz, sc, mc } = await publishedQuiz();
    await take(ids.s1, quiz.id, { [sc.id]: { optionId: 'A' }, [mc.id]: { optionIds: ['A', 'C'] } }); // 6/6
    await take(ids.s2, quiz.id, { [sc.id]: { optionId: 'B' }, [mc.id]: { optionIds: ['A'] } }); // 0 + 2 = 2/6

    const an = await getQuizAnalytics(teacher(), quiz.id);
    expect(an.summary).toMatchObject({ attempts: 2, average: '4.00', median: '4.00', highest: '6.00', lowest: '2.00' });
    expect(an.histogram).toHaveLength(10);
    expect(an.histogram[9].count).toBe(1); // 100 %
    expect(an.histogram[3].count).toBe(1); // 33 %
    const q1 = an.questions.find((q) => q.questionId === sc.id)!;
    expect(q1.percentCorrect).toBe(50);
    expect(q1.averagePoints).toBe('1.00');
    expect(q1.mostChosenWrongOptionId).toBe('B');
    expect(q1.optionDistribution?.find((o) => o.optionId === 'A')).toMatchObject({ count: 1, isCorrect: true });

    const csv = await analyticsCsv(teacher(), quiz.id);
    const lines = csv.trim().split(/\r?\n/);
    expect(lines[0]).toContain('Student');
    expect(lines[0]).toContain('Q1 (2.00)');
    expect(lines).toHaveLength(3);
    expect(csv).toContain('6.00');

    expect(await code(getQuizAnalytics(as(ids.s1, 'STUDENT'), quiz.id))).toBe('NOT_FOUND');
    expect(await code(getQuizAnalytics(as(ids.teacher2, 'TEACHER'), quiz.id))).toBe('NOT_FOUND');
  });

  it('FR-34/NFR-5: parent sees linked child result only once visible; others NOT_FOUND', async () => {
    const { quiz, sc } = await publishedQuiz({ resultsVisibility: 'MANUAL' });
    const attemptId = await take(ids.s1, quiz.id, { [sc.id]: { optionId: 'A' } });

    expect(await code(getAttemptView(as(ids.parent, 'PARENT'), attemptId))).toBe('NOT_FOUND'); // not released
    expect(await code(getAttemptView(as(ids.s2, 'STUDENT'), attemptId))).toBe('NOT_FOUND');
    expect(await code(getAttemptView(as(ids.teacher2, 'TEACHER'), attemptId))).toBe('NOT_FOUND');
    expect((await getAttemptView(teacher(), attemptId)).view).toBe('manager');

    await releaseResults(teacher(), quiz.id);
    expect((await getAttemptView(as(ids.parent, 'PARENT'), attemptId)).view).toBe('result');
    expect(await code(getAttemptView(as(ids.parent2, 'PARENT'), attemptId))).toBe('NOT_FOUND'); // unlinked

    // Students can't write to another student's attempt; teachers of other courses can't grade.
    expect(await code(saveAnswer(as(ids.s2, 'STUDENT'), attemptId, sc.id, { optionId: 'B' }))).toBe('NOT_FOUND');
    expect(await code(gradeAnswerManually(as(ids.teacher2, 'TEACHER'), attemptId, sc.id, { pointsAwarded: '0.00' }))).toBe('NOT_FOUND');
  });

  it('FR-28 + FR-38: accommodation feeds deadline; teacher actions write AuditLog rows', async () => {
    const { quiz, sc } = await publishedQuiz({ resultsVisibility: 'MANUAL', timeLimitMinutes: 10 });
    expect(await code(upsertAccommodation(teacher(), quiz.id, ids.outsider, { extraTimeMinutes: 5, extraAttempts: 0 }))).toBe('NOT_FOUND');
    await upsertAccommodation(teacher(), quiz.id, ids.s2, { extraTimeMinutes: 15, extraAttempts: 1 });

    const t0 = Date.now();
    const { attempt } = await startOrResumeAttempt(as(ids.s2, 'STUDENT'), quiz.id);
    const row = await prisma.quizAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    const mins = (row.deadlineAt!.getTime() - row.startedAt.getTime()) / MIN;
    expect(mins).toBeCloseTo(25, 1); // 10 + 15
    expect(row.startedAt.getTime()).toBeGreaterThanOrEqual(t0 - 1000);
    await saveAnswer(as(ids.s2, 'STUDENT'), attempt.id, sc.id, { optionId: 'B' });
    await submitForStudent(as(ids.s2, 'STUDENT'), attempt.id);

    await gradeAnswerManually(teacher(), attempt.id, sc.id, { pointsAwarded: '1.00', feedback: 'partial' });
    await regradeQuiz(teacher(), quiz.id);
    await releaseResults(teacher(), quiz.id);

    const actions = (await prisma.auditLog.findMany({ where: { actorId: ids.teacher, OR: [{ entityId: quiz.id }, { entityId: attempt.id }] }, select: { action: true } })).map((a) => a.action);
    for (const a of ['quiz.accommodation', 'quizAnswer.grade', 'quiz.regrade', 'quiz.release_results']) expect(actions).toContain(a);
  });

  it('FR-31: reorder must list every question exactly once', async () => {
    const quiz = await createQuiz(teacher(), ids.course, settings());
    const a = await addQuestion(teacher(), quiz.id, { type: 'TRUE_FALSE', prompt: 'a', points: '1.00', correct: { value: true }, explanation: null, caseSensitive: false });
    const b = await addQuestion(teacher(), quiz.id, { type: 'TRUE_FALSE', prompt: 'b', points: '1.00', correct: { value: false }, explanation: null, caseSensitive: false });
    expect(await code(reorderQuestions(teacher(), quiz.id, [a.id]))).toBe('VALIDATION_ERROR');
    expect(await code(reorderQuestions(teacher(), quiz.id, [a.id, a.id]))).toBe('VALIDATION_ERROR');
    expect((await reorderQuestions(teacher(), quiz.id, [b.id, a.id])).map((q) => q.id)).toEqual([b.id, a.id]);
  });

  it('NFR-2: autosave stays under 50 ms per save (50 concurrent saves)', async () => {
    const { quiz, sc, mc } = await publishedQuiz();
    const { attempt } = await startOrResumeAttempt(as(ids.s1, 'STUDENT'), quiz.id);
    await saveAnswer(as(ids.s1, 'STUDENT'), attempt.id, sc.id, { optionId: 'A' }); // warm up
    const times = await Promise.all(
      Array.from({ length: 50 }, async (_, i) => {
        const t = performance.now();
        await saveAnswer(as(ids.s1, 'STUDENT'), attempt.id, i % 2 ? sc.id : mc.id, i % 2 ? { optionId: 'B' } : { optionIds: ['A'] });
        return performance.now() - t;
      }),
    );
    const sorted = times.sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length / 2)]).toBeLessThan(50); // median under budget even when contended
    expect(await prisma.quizAnswer.count({ where: { attemptId: attempt.id } })).toBe(2); // upserts, not inserts
  });

  it('histogram puts 100 % in the last bucket and clamps', () => {
    const h = histogram([0, 9.99, 10, 100, 150, -5]);
    expect(h.map((b) => b.count)).toEqual([3, 1, 0, 0, 0, 0, 0, 0, 0, 2]);
  });
});
