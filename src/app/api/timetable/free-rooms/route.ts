import { ok, parseQuery, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { getFreeRooms } from '@/server/timetable/timetable-service';
import { freeRoomsQuerySchema } from '@/lib/validators/timetable';

/** GET /api/timetable/free-rooms — ADMIN (PRD-06 FR-21, D1). */
export const GET = withHandler(async (request: Request) => {
  await requireRole('ADMIN');
  return ok(await getFreeRooms(parseQuery(new URL(request.url).searchParams, freeRoomsQuerySchema)));
});
