import { ok, withHandler } from '@/server/http';
import { requireFeeAdmin } from '@/server/fees/access';
import { getAging } from '@/server/fees/reports';

/** GET /api/fees/aging — ADMIN read; buckets + top 10 overdue families (FR-42). */
export const GET = withHandler(async () => {
  await requireFeeAdmin();
  return ok(await getAging());
});
