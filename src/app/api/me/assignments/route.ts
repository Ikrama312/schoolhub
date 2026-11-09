import { ok, parseQuery, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { listMyAssignments } from '@/server/assignments/assignments-service';
import { meAssignmentsQuery } from '@/lib/validators/assignments';

export const dynamic = 'force-dynamic';

/** GET /api/me/assignments — student/parent rows or the teacher/admin "To grade" list (FR-57). */
export const GET = withHandler(async (request: Request) => {
  const user = await requireUser();
  const query = parseQuery(new URL(request.url).searchParams, meAssignmentsQuery);
  return ok(await listMyAssignments(user, query));
});
