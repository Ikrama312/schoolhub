import { ok, parseBody, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { assertCanViewCourse } from '@/server/auth/course-access';
import { ALL_ROLES } from '@/config/navigation';
import { getCourse, updateCourse } from '@/server/courses/courses-service';
import { courseUpdateSchema } from '@/lib/validators/courses';

type Ctx = { params: { id: string } };

/** GET /api/courses/:id (assertCanViewCourse) · PATCH (ADMIN) — FR-14/FR-16/FR-18. */
export const GET = withHandler(async (_request: Request, { params }: Ctx) => {
  const user = await requireRole(...ALL_ROLES);
  await assertCanViewCourse(user, params.id);
  return ok(await getCourse(params.id));
});

export const PATCH = withHandler(async (request: Request, { params }: Ctx) => {
  const actor = await requireRole('ADMIN');
  const input = await parseBody(request, courseUpdateSchema);
  return ok(await updateCourse(params.id, input, actor.id));
});
