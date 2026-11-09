import { ok, parseBody, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { setEnrollmentStatus } from '@/server/courses/courses-service';
import { enrollmentStatusSchema } from '@/lib/validators/courses';

/** PATCH /api/enrollments/:id — ADMIN; drop or reactivate (FR-12/FR-15). */
export const PATCH = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const actor = await requireRole('ADMIN');
  const input = await parseBody(request, enrollmentStatusSchema);
  return ok(await setEnrollmentStatus(params.id, input, actor.id));
});
