import { ok, parseQuery, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { getPersonalTimetable, resolvePersonalTarget } from '@/server/timetable/timetable-service';
import { meTimetableQuerySchema } from '@/lib/validators/timetable';

/** GET /api/me/timetable — PRD-06 FR-38, FR-25. ADMIN gets an empty week (D5). */
export const GET = withHandler(async (request: Request) => {
  const user = await requireUser();
  const q = parseQuery(new URL(request.url).searchParams, meTimetableQuerySchema);
  const target = await resolvePersonalTarget(user, q.studentId);
  return ok(await getPersonalTimetable(target, q.academicYearId));
});
