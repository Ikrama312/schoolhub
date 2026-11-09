import { ok, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { getToday } from '@/server/attendance/attendance-service';

/** GET /api/attendance/today — the teacher's meetings and daily registers today (FR-6, FR-7). */
export const GET = withHandler(async () => {
  const user = await requireRole('TEACHER', 'ADMIN');
  return ok(await getToday(user));
});
