import { timingSafeEqual } from 'node:crypto';
import { AppError, ok, withHandler } from '@/server/http';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { dispatchEmails } from '@/server/email/dispatch';
import { purgeOldNotifications } from '@/server/notifications/purge';
import { purgeOrphanFiles } from '@/server/files/purge';
import { sendDueReminders } from '@/server/assignments/reminders';
import { autoSubmitExpiredAttempts, sendAfterCloseResultsReleased } from '@/server/quiz/maintenance';

export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60_000;
// ponytail: in-memory lastPurgeAt (per process), move to a DB row if purge cost matters.
let lastPurgeAt = 0;

function authorized(header: string | null): boolean {
  if (!env.CRON_SECRET || !header?.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice('Bearer '.length));
  const expected = Buffer.from(env.CRON_SECRET);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** POST /api/internal/email/dispatch — cron entry point (FR-19, FR-27, NFR-8). */
export const POST = withHandler(async (request: Request) => {
  if (!authorized(request.headers.get('authorization'))) {
    throw new AppError('UNAUTHENTICATED', 'Invalid or missing cron secret.');
  }
  const result = await dispatchEmails({ batchSize: 50 });

  // PRD-09 FR-43/FR-45: every request, outside the daily purge block; idempotent per AssignmentReminder.
  try {
    const reminders = await sendDueReminders(new Date());
    if (reminders.dueSoon || reminders.missing) logger.info('Assignment reminders sent', reminders);
  } catch (error) {
    logger.error('Assignment reminders failed', { message: error instanceof Error ? error.message : String(error) });
  }

  // PRD-10 FR-18/FR-30/FR-35: every request, each isolated; both idempotent.
  try {
    const submitted = await autoSubmitExpiredAttempts(new Date());
    if (submitted) logger.info('Expired quiz attempts auto-submitted', { submitted });
  } catch (error) {
    logger.error('Quiz auto-submit failed', { message: error instanceof Error ? error.message : String(error) });
  }
  try {
    const released = await sendAfterCloseResultsReleased(new Date());
    if (released) logger.info('Quiz results released after close', { released });
  } catch (error) {
    logger.error('Quiz results release failed', { message: error instanceof Error ? error.message : String(error) });
  }

  if (Date.now() - lastPurgeAt > DAY_MS) {
    lastPurgeAt = Date.now();
    try {
      const purged = await purgeOldNotifications();
      logger.info('Purged old notifications', { purged });
    } catch (error) {
      logger.error('Notification purge failed', { message: error instanceof Error ? error.message : String(error) });
    }
    try {
      await purgeOrphanFiles(new Date());
    } catch (error) {
      logger.error('Orphan file purge failed', { message: error instanceof Error ? error.message : String(error) });
    }
  }
  return ok(result);
});
