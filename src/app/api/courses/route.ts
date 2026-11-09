import { ok, paginated, parseBody, parsePagination, parseQuery, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { ALL_ROLES } from '@/config/navigation';
import { createCourse, listCourses } from '@/server/courses/courses-service';
import { courseInputSchema, coursesListQuerySchema } from '@/lib/validators/courses';

/** GET /api/courses (any role, scoped in the service) · POST /api/courses (ADMIN) — FR-13/FR-14. */
export const GET = withHandler(async (request: Request) => {
  const user = await requireRole(...ALL_ROLES);
  const url = new URL(request.url);
  const query = parseQuery(url.searchParams, coursesListQuerySchema);
  const { page, pageSize, skip, take } = parsePagination(url.searchParams);
  const { rows, total } = await listCourses(user, query, { skip, take });
  return paginated(rows, { page, pageSize, total });
});

export const POST = withHandler(async (request: Request) => {
  const actor = await requireRole('ADMIN');
  const input = await parseBody(request, courseInputSchema);
  return ok(await createCourse(input, actor.id), { status: 201 });
});
