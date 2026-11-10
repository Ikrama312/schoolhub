import { ok, parseQuery, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { getPersonalTimetable, resolvePersonalTarget } from '@/server/timetable/timetable-service';
import { meTimetableQuerySchema } from '@/lib/validators/timetable';
import { getSelectedChild } from '@/server/parent/selected-child';

/** GET /api/me/timetable — PRD-06 FR-38, FR-25. ADMIN gets an empty week (D5). */
export const GET = withHandler(async (request: Request) => {
  const user = await requireUser();
  const q = parseQuery(new URL(request.url).searchParams, meTimetableQuerySchema);
  // PRD-15 FR-5: a PARENT without ?studentId gets the selected child (sh_child ▸ first) instead of an error.
  const studentId = q.studentId ?? (user.role === 'PARENT' ? (await getSelectedChild(user))?.studentId : undefined);
  const target = await resolvePersonalTarget(user, studentId);
  return ok(await getPersonalTimetable(target, q.academicYearId));
});
