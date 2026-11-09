import { ok, parseBody, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { bulkReturn } from '@/server/assignments/assignments-service';
import { bulkReturnInput } from '@/lib/validators/assignments';

/** POST /api/assignments/:id/return — "Return all graded" (FR-32). */
export const POST = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  const { submissionIds } = await parseBody(request, bulkReturnInput);
  return ok(await bulkReturn(user, params.id, submissionIds, request));
});
