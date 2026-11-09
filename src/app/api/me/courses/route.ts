import { ok, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { ALL_ROLES } from '@/config/navigation';
import { listMyCourses } from '@/server/courses/courses-service';

/** GET /api/me/courses — any role (FR-19). */
export const GET = withHandler(async () => {
  const user = await requireRole(...ALL_ROLES);
  return ok(await listMyCourses(user));
});
