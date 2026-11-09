import { ok, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { unreadCount } from '@/server/notifications/service';

export const dynamic = 'force-dynamic';

/** GET /api/notifications/unread-count (FR-35). */
export const GET = withHandler(async () => {
  const me = await requireUser();
  return ok({ count: await unreadCount(me.id) });
});
