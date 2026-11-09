import { ok, parseQuery, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { getAvailability } from '@/server/timetable/timetable-service';
import { availabilityQuerySchema } from '@/lib/validators/timetable';

/** GET /api/timetable/availability?courseId&roomId — ADMIN (PRD-06 FR-36, D2). */
export const GET = withHandler(async (request: Request) => {
  await requireRole('ADMIN');
  const q = parseQuery(new URL(request.url).searchParams, availabilityQuerySchema);
  return ok(await getAvailability(q.courseId, q.roomId));
});
