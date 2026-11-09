import { ok, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { markAllMissing } from '@/server/gradebook/gradebook-service';

/** POST /api/grade-items/:id/mark-missing — "Set all ungraded to missing" (FR-24). */
export const POST = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  return ok(await markAllMissing(user, params.id, request));
});
