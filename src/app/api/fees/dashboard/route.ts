import { ok, parseQuery, withHandler } from '@/server/http';
import { requireFeeAdmin } from '@/server/fees/access';
import { getDashboard } from '@/server/fees/reports';
import { dashboardQuery } from '@/lib/validators/fees';

/** GET /api/fees/dashboard — ADMIN read; KPIs + 12-week trend (FR-42). */
export const GET = withHandler(async (request: Request) => {
  await requireFeeAdmin();
  const { termId } = parseQuery(new URL(request.url).searchParams, dashboardQuery);
  return ok(await getDashboard(termId));
});
