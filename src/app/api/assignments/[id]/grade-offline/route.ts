import { ok, parseBody, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { gradeOffline } from '@/server/assignments/assignments-service';
import { offlineGradeInput } from '@/lib/validators/assignments';

/** POST /api/assignments/:id/grade-offline — "Grade without submission" (FR-34). */
export const POST = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  const input = await parseBody(request, offlineGradeInput);
  return ok(await gradeOffline(user, params.id, input, request), { status: 201 });
});
