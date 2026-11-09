import { ok, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { markRead } from '@/server/messaging/conversations';

/** POST /api/conversations/:id/read (FR-14, FR-20). */
export const POST = withHandler(async (_request: Request, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  return ok(await markRead(user, params.id));
});
