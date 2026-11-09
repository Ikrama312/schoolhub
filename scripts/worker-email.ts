/**
 * Email worker (PRD-04 FR-20): `npm run worker:email`. Dispatches the outbox
 * every 15 s. Purge is not run here; only the cron endpoint purges.
 */
import { dispatchEmails } from '@/server/email/dispatch';
import { prisma } from '@/server/db';
import { logger } from '@/lib/logger';

const INTERVAL_MS = 15_000;
let running = true;
let wake: (() => void) | null = null;

function stop() {
  running = false;
  wake?.();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

async function main() {
  logger.info('Email worker started', { intervalMs: INTERVAL_MS });
  while (running) {
    try {
      const result = await dispatchEmails();
      if (result.sent || result.failed || result.retried) logger.info('Email dispatch', result);
    } catch (error) {
      logger.error('Email dispatch failed', { message: error instanceof Error ? error.message : String(error) });
    }
    if (!running) break;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, INTERVAL_MS);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
  await prisma.$disconnect();
  logger.info('Email worker stopped');
}

void main();
