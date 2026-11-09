import { ok, parseBody, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { createCoreCourses } from '@/server/courses/courses-service';
import { coreCoursesSchema } from '@/lib/validators/sections';

/** POST /api/sections/:id/core-courses — ADMIN (FR-5). */
export const POST = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const actor = await requireRole('ADMIN');
  const input = await parseBody(request, coreCoursesSchema);
  return ok(await createCoreCourses(params.id, input, actor.id), { status: 201 });
});
