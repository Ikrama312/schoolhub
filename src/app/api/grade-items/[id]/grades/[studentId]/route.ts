import { ok, parseBody, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { putGrade } from '@/server/gradebook/gradebook-service';
import { gradePutSchema } from '@/lib/validators/gradebook';

/** PUT /api/grade-items/:id/grades/:studentId — one cell (FR-20, FR-9). */
export const PUT = withHandler(async (request: Request, { params }: { params: { id: string; studentId: string } }) => {
  const user = await requireUser();
  const input = await parseBody(request, gradePutSchema);
  return ok(await putGrade(user, params.id, params.studentId, input, request));
});
