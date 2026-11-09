import { paginated, parsePagination, parseQuery, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { listNotificationsQuery } from '@/lib/validators/notifications';
import { listNotifications } from '@/server/notifications/service';

/** GET /api/notifications — caller's own, paginated (FR-34). */
export const GET = withHandler(async (request: Request) => {
  const me = await requireUser();
  const url = new URL(request.url);
  const query = parseQuery(url.searchParams, listNotificationsQuery);
  const { page, pageSize, skip, take } = parsePagination(url.searchParams);
  const { rows, total } = await listNotifications(me.id, query, { skip, take });
  return paginated(rows, { page, pageSize, total });
});
