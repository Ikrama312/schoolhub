import { timingSafeEqual } from 'node:crypto';
import { AppError, ok, withHandler } from '@/server/http';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { dispatchEmails } from '@/server/email/dispatch';
import { purgeOldNotifications } from '@/server/notifications/purge';
import { purgeOrphanFiles } from '@/server/files/purge';
import { sendDueReminders } from '@/server/assignments/reminders';
import { autoSubmitExpiredAttempts, sendAfterCloseResultsReleased } from '@/server/quiz/maintenance';
import { processPendingMessageEmails } from '@/server/messaging/email';
import { sendConsentDueReminders } from '@/server/consent-forms/consent-forms-service';
import { recomputeRiskSnapshots } from '@/server/dashboards/risk';
import { markOverdue, sendInvoiceReminders } from '@/server/fees/maintenance';
import { feeSettings } from '@/server/fees/ledger';

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

  // PRD-13 FR-20: deferred message emails, isolated like the jobs above.
  let messageEmails = { sent: 0, deferred: 0, dropped: 0 };
  try {
    messageEmails = await processPendingMessageEmails(new Date());
    if (messageEmails.sent || messageEmails.deferred || messageEmails.dropped) logger.info('Message emails processed', messageEmails);
  } catch (error) {
    logger.error('Message emails failed', { message: error instanceof Error ? error.message : String(error) });
  }

  // PRD-15 FR-40: one 48 h consent reminder per form (claimed via dueReminderSentAt), isolated.
  let consentReminders = { forms: 0, notified: 0 };
  try {
    consentReminders = await sendConsentDueReminders(new Date());
    if (consentReminders.forms) logger.info('Consent due reminders sent', consentReminders);
  } catch (error) {
    logger.error('Consent due reminders failed', { message: error instanceof Error ? error.message : String(error) });
  }

  // PRD-16 FR-27: hourly risk recompute, gated in the DB (skips while snapshots are < 60 min old), isolated.
  let riskSnapshots: Awaited<ReturnType<typeof recomputeRiskSnapshots>> | null = null;
  try {
    riskSnapshots = await recomputeRiskSnapshots();
    if (!riskSnapshots.skipped) logger.info('Risk snapshots recomputed', riskSnapshots);
  } catch (error) {
    logger.error('Risk snapshot recompute failed', { message: error instanceof Error ? error.message : String(error) });
  }

  // PRD-17 FR-25/FR-37: overdue sweep then reminders, isolated; both idempotent (InvoiceReminder unique key).
  const fees = { overdue: 0, remindersSent: 0 };
  try {
    const now = new Date();
    fees.overdue = (await markOverdue((await feeSettings(now)).today)).updated;
    fees.remindersSent = (await sendInvoiceReminders(now)).sent;
    if (fees.overdue || fees.remindersSent) logger.info('Fee maintenance ran', fees);
  } catch (error) {
    logger.error('Fee maintenance failed', { message: error instanceof Error ? error.message : String(error) });
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
  return ok({ ...result, messageEmails, consentReminders, riskSnapshots, fees });
});
