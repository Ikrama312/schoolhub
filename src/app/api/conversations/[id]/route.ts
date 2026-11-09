import { ok, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { getConversation } from '@/server/messaging/conversations';

export const dynamic = 'force-dynamic';

/** GET /api/conversations/:id — header, participants, canSend, canLeave (FR-7, FR-14). 404 for non-participants. */
export const GET = withHandler(async (_request: Request, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  return ok(await getConversation(user, params.id));
});
