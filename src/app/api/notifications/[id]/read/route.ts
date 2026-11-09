import { ok, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { setRead } from '@/server/notifications/service';

type Ctx = { params: { id: string } };

/** POST /api/notifications/:id/read — owner only, 404 otherwise (FR-36). */
export const POST = withHandler(async (_request: Request, { params }: Ctx) => {
  const me = await requireUser();
  return ok(await setRead(me.id, params.id, true));
});
