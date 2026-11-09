import { ok, parseBody, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { archiveSchema } from '@/lib/validators/messaging';
import { setArchived } from '@/server/messaging/conversations';

/** POST /api/conversations/:id/archive — per-user (FR-9, FR-14). */
export const POST = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  const { archived } = await parseBody(request, archiveSchema);
  return ok(await setArchived(user, params.id, archived));
});
