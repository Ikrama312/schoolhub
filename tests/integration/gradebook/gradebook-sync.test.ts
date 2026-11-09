// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DATABASE_URL ??= 'postgresql://unused@localhost/unused';
  process.env.APP_URL ??= 'http://localhost:3000';
  process.env.AUTH_SECRET ??= 'test-secret';
});

import { prisma } from '@/server/db';
import {
  createAssignment,
  deleteOrArchiveAssignment,
  gradeSubmission,
  setExemption,
  submit,
  updateAssignment,
} from '@/server/assignments/assignments-service';
import { assignmentInput, gradeInput } from '@/lib/validators/assignments';
import { createQuiz, releaseResults, updateQuiz, deleteQuiz } from '@/server/quiz/quiz-service';
import { saveAnswer, startOrResumeAttempt, submitForStudent } from '@/server/quiz/attempt-service';
import { sendAfterCloseResultsReleased } from '@/server/quiz/maintenance';
import { quizSettingsSchema } from '@/lib/validators/quiz';

/**
 * PRD-11 source → gradebook sync (FR-3–FR-7, NFR-12) against a real, migrated Postgres.
 * Fixtures tagged with MARK and removed afterwards. Skipped without TEST_DATABASE_URL.
 */
const MARK = 'qa-sh11-sync';
const DAY = 86_400_000;
const ids = {} as Record<'year' | 'term' | 'subject' | 'course' | 'teacher' | 's1' | 's2', string>;
const T = () => ({ id: ids.teacher, role: 'TEACHER' as const });
const S = (id: string) => ({ id, role: 'STUDENT' as const });
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const item = (sourceId: string) => prisma.gradeItem.findUnique({ where: { sourceId } });
const grade = async (sourceId: string, studentId: string) => {
  const i = await item(sourceId);
  return i ? prisma.grade.findUnique({ where: { gradeItemId_studentId: { gradeItemId: i.id, studentId } } }) : null;
};

async function mkAssignment(extra: Record<string, unknown> = {}) {
  const a = await createAssignment(
    T(),
    ids.course,
    assignmentInput.parse({ title: `${MARK} hw`, submissionType: 'ONLINE_TEXT', maxPoints: 20, dueAt: new Date(Date.now() + DAY), status: 'PUBLISHED', ...extra }),
  );
  return a.id;
}

async function mkQuiz(resultsVisibility: 'IMMEDIATELY' | 'AFTER_CLOSE' | 'MANUAL', extra: Record<string, unknown> = {}) {
  const now = Date.now();
  const q = await createQuiz(
    T(),
    ids.course,
    quizSettingsSchema.parse({ title: `${MARK} quiz`, availableFrom: new Date(now - DAY), availableUntil: new Date(now + DAY), resultsVisibility, ...extra }),
  );
  await prisma.question.create({ data: { quizId: q.id, type: 'TRUE_FALSE', prompt: 'T?', points: '4', order: 0, correct: { value: true } } });
  await prisma.question.create({ data: { quizId: q.id, type: 'TRUE_FALSE', prompt: 'F?', points: '1', order: 1, correct: { value: false } } });
  await updateQuiz(T(), q.id, { status: 'PUBLISHED' });
  return q.id;
}

async function takeQuiz(quizId: string, studentId: string, answers: boolean[]) {
  const { attempt } = await startOrResumeAttempt(S(studentId), quizId);
  const qs = await prisma.question.findMany({ where: { quizId }, orderBy: { order: 'asc' } });
  for (const [i, value] of answers.entries()) await saveAnswer(S(studentId), attempt.id, qs[i].id, { value });
  await submitForStudent(S(studentId), attempt.id);
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('gradebook sync (integration)', () => {
  beforeAll(async () => {
    const mk = (n: string, role: 'TEACHER' | 'STUDENT') =>
      prisma.user.create({ data: { email: `${n}@${MARK}.test`, firstName: 'QA', lastName: n, role, status: 'ACTIVE' } }).then((u) => u.id);
    Object.assign(ids, { teacher: await mk('teacher', 'TEACHER'), s1: await mk('s1', 'STUDENT'), s2: await mk('s2', 'STUDENT') });
    const now = Date.now();
    ids.year = (await prisma.academicYear.create({ data: { name: MARK, startDate: new Date(isoDay(now - 200 * DAY)), endDate: new Date(isoDay(now + 200 * DAY)) } })).id;
    ids.term = (await prisma.term.create({ data: { academicYearId: ids.year, name: 'T1', order: 1, startDate: new Date(isoDay(now - 100 * DAY)), endDate: new Date(isoDay(now + 100 * DAY)) } })).id;
    ids.subject = (await prisma.subject.create({ data: { name: MARK, code: MARK.toUpperCase() } })).id;
    ids.course = (await prisma.course.create({ data: { name: MARK, code: MARK, academicYearId: ids.year, subjectId: ids.subject, teacherId: ids.teacher } })).id;
    await prisma.enrollment.createMany({ data: [ids.s1, ids.s2].map((studentId) => ({ courseId: ids.course, studentId })) });
  });

  afterAll(async () => {
    const users = [ids.teacher, ids.s1, ids.s2].filter(Boolean);
    await prisma.course.deleteMany({ where: { code: MARK } });
    await prisma.term.deleteMany({ where: { academicYearId: ids.year } });
    await prisma.notification.deleteMany({ where: { userId: { in: users } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.subject.deleteMany({ where: { code: MARK.toUpperCase() } });
    await prisma.academicYear.deleteMany({ where: { name: MARK } });
  });

  it('publishing an assignment creates its item in the containing term; drafts do not', async () => {
    const draft = await mkAssignment({ status: 'DRAFT' });
    expect(await item(draft)).toBeNull();
    const pub = await mkAssignment();
    expect(await item(pub)).toMatchObject({ source: 'ASSIGNMENT', termId: ids.term, isVisible: true, courseId: ids.course });
    expect((await item(pub))!.maxPoints.toFixed(2)).toBe('20.00');
    await updateAssignment(T(), draft, { status: 'PUBLISHED' });
    expect(await item(draft)).toMatchObject({ isVisible: true });
  });

  it('AC-3: return syncs the score; saving without returning does not', async () => {
    const id = await mkAssignment();
    const sub1 = (await submit(S(ids.s1), id, { text: 'x', fileIds: [] })).submission.id;
    const sub2 = (await submit(S(ids.s2), id, { text: 'y', fileIds: [] })).submission.id;
    await gradeSubmission(T(), sub1, gradeInput.parse({ rawScore: 15, penaltyPercent: 0, return: false }));
    expect(await grade(id, ids.s1)).toBeNull();
    await gradeSubmission(T(), sub1, gradeInput.parse({ rawScore: 16, penaltyPercent: 0, return: true }));
    expect((await grade(id, ids.s1))?.score?.toFixed(2)).toBe('16.00');
    // Re-grade of returned work re-syncs.
    await gradeSubmission(T(), sub1, gradeInput.parse({ rawScore: 18, penaltyPercent: 0, return: false }));
    expect((await grade(id, ids.s1))?.score?.toFixed(2)).toBe('18.00');
    await gradeSubmission(T(), sub2, gradeInput.parse({ rawScore: 10, penaltyPercent: 0 }));
    expect(await grade(id, ids.s2)).toBeNull();
  });

  it('FR-6 / A1: exemption sets excused; removing it re-derives from the source', async () => {
    const id = await mkAssignment();
    await setExemption(T(), id, ids.s1, true);
    expect(await grade(id, ids.s1)).toMatchObject({ excused: true, score: null });
    await setExemption(T(), id, ids.s1, false);
    expect(await grade(id, ids.s1)).toMatchObject({ excused: false, score: null });
  });

  it('FR-4: archive hides, hard delete removes; A7: teacher hide survives a re-save', async () => {
    const a = await mkAssignment();
    await submit(S(ids.s1), a, { text: 'x', fileIds: [] });
    await deleteOrArchiveAssignment(T(), a);
    expect(await item(a)).toMatchObject({ isVisible: false });

    const b = await mkAssignment();
    await deleteOrArchiveAssignment(T(), b);
    expect(await item(b)).toBeNull();

    const c = await mkAssignment();
    await prisma.gradeItem.update({ where: { sourceId: c }, data: { isVisible: false } });
    await updateAssignment(T(), c, { title: `${MARK} renamed` });
    expect(await item(c)).toMatchObject({ isVisible: false, title: `${MARK} renamed` });
  });

  it('FR-7: IMMEDIATELY quiz syncs on submit, scaled to maxPoints', async () => {
    const q = await mkQuiz('IMMEDIATELY');
    expect((await item(q))?.maxPoints.toFixed(2)).toBe('5.00');
    await takeQuiz(q, ids.s1, [true, true]);
    expect((await grade(q, ids.s1))?.score?.toFixed(2)).toBe('4.00');
  });

  it('FR-7: MANUAL quiz syncs only on release', async () => {
    const q = await mkQuiz('MANUAL');
    await takeQuiz(q, ids.s1, [true, false]);
    expect(await grade(q, ids.s1)).toBeNull();
    await releaseResults(T(), q);
    expect((await grade(q, ids.s1))?.score?.toFixed(2)).toBe('5.00');
  });

  it('FR-7 / R1: AFTER_CLOSE quiz syncs when the maintenance claim runs after close', async () => {
    const q = await mkQuiz('AFTER_CLOSE');
    await takeQuiz(q, ids.s2, [false, false]);
    expect(await grade(q, ids.s2)).toBeNull();
    await prisma.quiz.update({ where: { id: q }, data: { availableUntil: new Date(Date.now() - 1000) } });
    await sendAfterCloseResultsReleased();
    expect((await grade(q, ids.s2))?.score?.toFixed(2)).toBe('1.00');
  });

  it('practice quizzes never get an item; toggling practice on deletes it; deleting the quiz deletes it', async () => {
    const practice = await mkQuiz('IMMEDIATELY', { isPractice: true });
    expect(await item(practice)).toBeNull();
    const q = await mkQuiz('IMMEDIATELY');
    expect(await item(q)).not.toBeNull();
    await updateQuiz(T(), q, { isPractice: true });
    expect(await item(q)).toBeNull();

    const d = await mkQuiz('IMMEDIATELY');
    await deleteQuiz(T(), d);
    expect(await item(d)).toBeNull();
  });
});
