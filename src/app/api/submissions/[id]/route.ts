import { ok, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { getSubmission } from '@/server/assignments/assignments-service';

/** GET /api/submissions/:id — submitter, linked parent or manager; history for managers only (FR-55). */
export const GET = withHandler(async (_request: Request, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  return ok(await getSubmission(user, params.id));
});
