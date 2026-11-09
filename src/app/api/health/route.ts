import { prisma } from '@/server/db';
import { ok, withHandler } from '@/server/http';

const DB_CHECK_BUDGET_MS = 2000;

async function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error('db check timed out')), ms);
  });
}

export const GET = withHandler(async () => {
  try {
    await Promise.race([prisma.$queryRaw`SELECT 1`, timeout(DB_CHECK_BUDGET_MS)]);
    return ok({ status: 'ok', db: 'ok', time: new Date().toISOString() });
  } catch {
    // 503, not the generic INTERNAL/500 shape — FR-16 requires this exact
    // status+body pair for a failed liveness check.
    return ok(
      { status: 'error', db: 'error', time: new Date().toISOString() },
      { status: 503 },
    );
  }
});
