import { ok, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { unreadCount } from '@/server/messaging/conversations';

export const dynamic = 'force-dynamic';

/** GET /api/messaging/unread-count — sidebar badge, polled every 30 s (FR-18). */
export const GET = withHandler(async () => {
  const user = await requireUser();
  return ok({ count: await unreadCount(user.id) });
});
