import { paginated, parsePagination, parseQuery, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { emailLogQuery } from '@/lib/validators/notifications';
import { listEmailLog } from '@/server/email/admin';

/** GET /api/admin/email-log — ADMIN (FR-39). */
export const GET = withHandler(async (request: Request) => {
  await requireRole('ADMIN');
  const url = new URL(request.url);
  const query = parseQuery(url.searchParams, emailLogQuery);
  const { page, pageSize, skip, take } = parsePagination(url.searchParams);
  const { rows, total } = await listEmailLog(query, { skip, take });
  return paginated(rows, { page, pageSize, total });
});
