import { prisma } from '@/server/db';
import { ANSWER_GRACE_MS } from './grading';
import { submitAttempt } from './attempt-service';
import { notifyResultsReleased } from './quiz-service';
import { syncQuizGrades } from '@/server/gradebook/gradebook-sync';

/**
 * PRD-10 maintenance (FR-18, FR-30, FR-35), run by the internal dispatch cron on every call.
 * Both passes are idempotent across concurrent calls.
 */

const BATCH = 200;

/** IN_PROGRESS attempts past deadline + grace → auto-submit (≤ 200 per call; lazy path covers the rest). */
export async function autoSubmitExpiredAttempts(now = new Date()): Promise<number> {
  const expired = await prisma.quizAttempt.findMany({
    where: { status: 'IN_PROGRESS', deadlineAt: { lt: new Date(now.getTime() - ANSWER_GRACE_MS) } },
    select: { id: true },
    orderBy: { deadlineAt: 'asc' },
    take: BATCH,
  });
  let submitted = 0;
  for (const a of expired) if (await submitAttempt(a.id, { auto: true }, now)) submitted++;
  return submitted;
}

/** A6: AFTER_CLOSE quizzes past close are claimed via resultsReleasedAt null → now; only the claimer notifies. */
export async function sendAfterCloseResultsReleased(now = new Date()): Promise<number> {
  const due = await prisma.quiz.findMany({
    where: { resultsVisibility: 'AFTER_CLOSE', availableUntil: { lte: now }, resultsReleasedAt: null, status: { not: 'DRAFT' } },
    select: { id: true },
    take: BATCH,
  });
  let sent = 0;
  for (const q of due) {
    const { count } = await prisma.quiz.updateMany({ where: { id: q.id, resultsReleasedAt: null }, data: { resultsReleasedAt: now } });
    if (count !== 1) continue;
    await syncQuizGrades(q.id, now); // PRD-11 FR-7 (R1)
    await notifyResultsReleased(q.id);
    sent++;
  }
  return sent;
}
