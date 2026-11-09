import { prisma } from '@/server/db';
import { logger } from '@/lib/logger';
import { nextRetry } from './backoff';
import { sendMail } from './transport';

const STUCK_AFTER_MS = 10 * 60_000;

interface ClaimedRow {
  id: string;
  toEmail: string;
  toName: string | null;
  subject: string;
  html: string;
  text: string;
  attempts: number;
}

/**
 * FR-17/18, NFR-4/5. Recovers stuck SENDING rows, claims a batch in one
 * autocommit statement (FOR UPDATE SKIP LOCKED, so concurrent dispatchers
 * never share a row and no lock is held during SMTP), then sends sequentially.
 */
export async function dispatchEmails({ batchSize = 50 }: { batchSize?: number } = {}): Promise<{
  sent: number;
  failed: number;
  retried: number;
}> {
  // NFR-5: a crash mid-send leaves SENDING; attempts unchanged (not proven to be a send failure).
  await prisma.emailOutbox.updateMany({
    where: { status: 'SENDING', updatedAt: { lt: new Date(Date.now() - STUCK_AFTER_MS) } },
    data: { status: 'PENDING' },
  });

  // Columns are timestamp(3) without tz holding UTC, hence AT TIME ZONE 'UTC'.
  const claimed = await prisma.$queryRaw<ClaimedRow[]>`
    UPDATE "EmailOutbox"
    SET "status" = 'SENDING'::"EmailStatus", "updatedAt" = (now() AT TIME ZONE 'UTC')
    WHERE "id" IN (
      SELECT "id" FROM "EmailOutbox"
      WHERE "status" = 'PENDING'::"EmailStatus" AND "nextAttemptAt" <= (now() AT TIME ZONE 'UTC')
      ORDER BY "nextAttemptAt"
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "toEmail", "toName", "subject", "html", "text", "attempts"`;

  const result = { sent: 0, failed: 0, retried: 0 };
  for (const row of claimed) {
    try {
      await sendMail({ to: row.toEmail, toName: row.toName, subject: row.subject, html: row.html, text: row.text });
      await prisma.emailOutbox.update({ where: { id: row.id }, data: { status: 'SENT', sentAt: new Date() } });
      result.sent++;
    } catch (error) {
      const attempts = row.attempts + 1;
      const decision = nextRetry(attempts);
      const lastError = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
      await prisma.emailOutbox.update({ where: { id: row.id }, data: { attempts, lastError, ...decision } });
      if (decision.status === 'FAILED') {
        result.failed++;
        logger.warn('Email permanently failed', { id: row.id, attempts });
      } else {
        result.retried++;
      }
    }
  }
  return result;
}
