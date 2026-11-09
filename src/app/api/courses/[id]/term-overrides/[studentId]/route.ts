import { ok, parseBody, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { putTermOverride } from '@/server/gradebook/gradebook-service';
import { termOverrideSchema } from '@/lib/validators/gradebook';

/** PUT /api/courses/:id/term-overrides/:studentId — manage (FR-23, FR-14). */
export const PUT = withHandler(async (request: Request, { params }: { params: { id: string; studentId: string } }) => {
  const user = await requireUser();
  const input = await parseBody(request, termOverrideSchema);
  return ok(await putTermOverride(user, params.id, params.studentId, input, request));
});
