/**
 * PRD-11 FR-8: `npm run gradebook:backfill`. Creates gradebook items and grades for assignments
 * and quizzes that existed before the gradebook. Idempotent; safe to re-run.
 */
import { backfillGradebook } from '@/server/gradebook/backfill';
import { prisma } from '@/server/db';
import { logger } from '@/lib/logger';

backfillGradebook()
  .then((summary) => {
    logger.info('Gradebook backfill complete', summary);
    process.exitCode = 0;
  })
  .catch((error) => {
    logger.error('Gradebook backfill failed', { message: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
