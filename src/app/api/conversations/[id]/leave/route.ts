import { ok, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { leave } from '@/server/messaging/conversations';

/** POST /api/conversations/:id/leave (FR-14). 403 ONE_TO_ONE | CREATOR_OF_STUDENT_GROUP. */
export const POST = withHandler(async (_request: Request, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  return ok(await leave(user, params.id));
});
