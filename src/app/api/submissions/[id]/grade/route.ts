import { ok, parseBody, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { gradeSubmission } from '@/server/assignments/assignments-service';
import { gradeInput } from '@/lib/validators/assignments';

/** PUT /api/submissions/:id/grade — Save, or Save & return with return:true (FR-56, D6). */
export const PUT = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  const input = await parseBody(request, gradeInput);
  return ok(await gradeSubmission(user, params.id, input, request));
});
