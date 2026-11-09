import { ok, parseQuery, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { getOverview } from '@/server/attendance/attendance-service';
import { overviewQuery } from '@/lib/validators/attendance';

/** GET /api/admin/attendance/overview?date — expected vs taken, missing registers (FR-30, FR-31). */
export const GET = withHandler(async (request: Request) => {
  await requireRole('ADMIN');
  const { date } = parseQuery(new URL(request.url).searchParams, overviewQuery);
  return ok(await getOverview(date));
});
