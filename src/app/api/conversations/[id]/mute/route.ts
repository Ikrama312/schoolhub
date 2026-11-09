import { ok, parseBody, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { muteSchema } from '@/lib/validators/messaging';
import { setMuted } from '@/server/messaging/conversations';

/** POST /api/conversations/:id/mute — per-user (FR-14, FR-19). */
export const POST = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  const { muted } = await parseBody(request, muteSchema);
  return ok(await setMuted(user, params.id, muted));
});
