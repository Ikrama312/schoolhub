import { paginated, parsePagination, parseQuery, withHandler } from '@/server/http';
import { reportsQuery } from '@/lib/validators/messaging';
import { requireSafeguardingLead } from '@/server/messaging/access';
import { listReports } from '@/server/messaging/safeguarding';

export const dynamic = 'force-dynamic';

/** GET /api/safeguarding/reports?status= — OPEN first (FR-23). Safeguarding leads only. */
export const GET = withHandler(async (request: Request) => {
  const lead = await requireSafeguardingLead();
  const { searchParams } = new URL(request.url);
  const { status } = parseQuery(searchParams, reportsQuery);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const { data, total } = await listReports(lead, { status, skip, take });
  return paginated(data, { page, pageSize, total });
});
