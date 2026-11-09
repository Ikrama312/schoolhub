import { prisma } from '@/server/db';
import { toCsv } from '@/server/csv';
import type { AccessUser } from '@/server/auth/student-access';
import { Decimal, dec, fixed2 } from '@/server/assignments/grading-math';
import { percentOf } from './grading';
import { manageCourseOrNotFound, quizNotFound } from './access';

/**
 * FR-26/FR-27: in-memory aggregation over submitted attempts (class sizes are small).
 */

type Option = { id: string; text: string };

async function load(user: AccessUser, quizId: string) {
  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    select: {
      courseId: true,
      questions: { orderBy: { order: 'asc' } },
      attempts: {
        where: { status: { not: 'IN_PROGRESS' } },
        include: { answers: true, student: { select: { firstName: true, lastName: true } } },
        orderBy: [{ student: { lastName: 'asc' } }, { attemptNumber: 'asc' }],
      },
    },
  });
  if (!quiz) throw quizNotFound();
  await manageCourseOrNotFound(user, quiz.courseId);
  return quiz;
}

export const HISTOGRAM_LABELS = Array.from({ length: 10 }, (_, i) => `${i * 10}–${i * 10 + 10}`);

/** 10 buckets by percent; 100 % lands in the last bucket. Pure. */
export function histogram(percents: readonly number[]) {
  const counts = new Array(10).fill(0) as number[];
  for (const p of percents) counts[Math.min(9, Math.max(0, Math.floor(p / 10)))]++;
  return HISTOGRAM_LABELS.map((bucket, i) => ({ bucket, count: counts[i] }));
}

function median(sorted: readonly Decimal[]): Decimal | null {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : sorted[mid - 1].plus(sorted[mid]).div(2);
}

export async function getQuizAnalytics(user: AccessUser, quizId: string) {
  const quiz = await load(user, quizId);
  const attempts = quiz.attempts;
  const scores = attempts.map((a) => dec(a.score ?? 0)).sort((x, y) => x.comparedTo(y));
  const n = scores.length;
  const times = attempts.filter((a) => a.submittedAt).map((a) => (a.submittedAt!.getTime() - a.startedAt.getTime()) / 1000);

  const summary = {
    attempts: n,
    average: n ? fixed2(scores.reduce((s, x) => s.plus(x), new Decimal(0)).div(n)) : null,
    median: n ? fixed2(median(scores)!) : null,
    highest: n ? fixed2(scores[n - 1]) : null,
    lowest: n ? fixed2(scores[0]) : null,
    averageTimeSeconds: times.length ? Math.round(times.reduce((s, t) => s + t, 0) / times.length) : null,
  };

  const questions = quiz.questions.map((q) => {
    const answers = attempts.map((a) => a.answers.find((x) => x.questionId === q.id)).filter((a) => a !== undefined);
    const graded = answers.filter((a) => a.pointsAwarded !== null);
    const isChoice = q.type === 'SINGLE_CHOICE' || q.type === 'MULTIPLE_CHOICE';
    const correct = (q.correct ?? {}) as { optionId?: string; optionIds?: string[] };
    const correctIds = new Set(q.type === 'SINGLE_CHOICE' ? [correct.optionId] : correct.optionIds ?? []);
    let optionDistribution: { optionId: string; text: string; count: number; isCorrect: boolean }[] | null = null;
    let mostChosenWrongOptionId: string | null = null;
    if (isChoice) {
      const counts = new Map<string, number>();
      for (const a of answers) {
        const r = (a.response ?? {}) as { optionId?: string; optionIds?: string[] };
        for (const id of q.type === 'SINGLE_CHOICE' ? [r.optionId] : r.optionIds ?? []) if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      optionDistribution = ((q.options ?? []) as Option[]).map((o) => ({ optionId: o.id, text: o.text, count: counts.get(o.id) ?? 0, isCorrect: correctIds.has(o.id) }));
      const wrong = optionDistribution.filter((o) => !o.isCorrect && o.count > 0).sort((x, y) => y.count - x.count);
      mostChosenWrongOptionId = wrong[0]?.optionId ?? null;
    }
    return {
      questionId: q.id,
      order: q.order,
      type: q.type,
      prompt: q.prompt,
      points: fixed2(q.points),
      percentCorrect: answers.length ? Math.round((answers.filter((a) => a.isCorrect === true).length / answers.length) * 1000) / 10 : null,
      averagePoints: graded.length ? fixed2(graded.reduce((s, a) => s.plus(dec(a.pointsAwarded!)), new Decimal(0)).div(graded.length)) : null,
      optionDistribution,
      mostChosenWrongOptionId,
    };
  });

  return { summary, histogram: histogram(attempts.map((a) => percentOf(a.score ?? 0, a.maxScore) ?? 0)), questions };
}
export type QuizAnalytics = Awaited<ReturnType<typeof getQuizAnalytics>>;

/** FR-27 CSV: student, attemptNumber, score, then one points column per question in quiz order. */
export async function analyticsCsv(user: AccessUser, quizId: string): Promise<string> {
  const quiz = await load(user, quizId);
  const columns = [
    { key: 'student', header: 'Student' },
    { key: 'attemptNumber', header: 'Attempt' },
    { key: 'score', header: 'Score' },
    ...quiz.questions.map((q, i) => ({ key: q.id, header: `Q${i + 1} (${fixed2(q.points)})` })),
  ];
  const rows = quiz.attempts.map((a) => ({
    student: `${a.student.firstName} ${a.student.lastName}`,
    attemptNumber: a.attemptNumber,
    score: a.score === null ? '' : fixed2(a.score),
    ...Object.fromEntries(
      quiz.questions.map((q) => {
        const ans = a.answers.find((x) => x.questionId === q.id);
        return [q.id, ans?.pointsAwarded == null ? '' : fixed2(ans.pointsAwarded)];
      }),
    ),
  }));
  return toCsv(columns, rows);
}
