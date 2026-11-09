import { paginated, parsePagination, parseQuery, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { assertCanViewCourse } from '@/server/auth/course-access';
import { ALL_ROLES } from '@/config/navigation';
import { getCourseRoster, type RosterEntry } from '@/server/courses/courses-service';
import { rosterQuerySchema } from '@/lib/validators/courses';

/** GET /api/courses/:id/roster — same getCourseRoster as the Roster tab (FR-17, NFR-4; PARENT refused there). */
export const GET = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const user = await requireRole(...ALL_ROLES);
  await assertCanViewCourse(user, params.id);
  const url = new URL(request.url);
  const query = parseQuery(url.searchParams, rosterQuerySchema);
  const { page, pageSize, skip, take } = parsePagination(url.searchParams);
  const { rows, total } = await getCourseRoster(params.id, user.role, query, { skip, take });
  return paginated<RosterEntry | { name: string }>(rows, { page, pageSize, total });
});
