import { ok, parseBody, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { duplicateAssignment } from '@/server/assignments/assignments-service';
import { duplicateInput } from '@/lib/validators/assignments';

/** POST /api/assignments/:id/duplicate — copy as DRAFT to managed courses (FR-15). */
export const POST = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  const { courseIds } = await parseBody(request, duplicateInput);
  return ok(await duplicateAssignment(user, params.id, courseIds, request), { status: 201 });
});
