import { ok, parseQuery, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { assertCanViewTimetable, getTimetable } from '@/server/timetable/timetable-service';
import { timetableQuerySchema } from '@/lib/validators/timetable';

/** GET /api/timetable?view&id&academicYearId — PRD-06 FR-35. */
export const GET = withHandler(async (request: Request) => {
  const user = await requireUser();
  const q = parseQuery(new URL(request.url).searchParams, timetableQuerySchema);
  await assertCanViewTimetable(user, q.view, q.id);
  return ok(await getTimetable(q.view, q.id, q.academicYearId));
});
