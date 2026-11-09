import { ok, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { markAllRead } from '@/server/notifications/service';

/** POST /api/notifications/read-all (FR-36). Idempotent. */
export const POST = withHandler(async () => {
  const me = await requireUser();
  return ok(await markAllRead(me.id));
});
