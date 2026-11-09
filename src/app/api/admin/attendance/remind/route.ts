import { ok, parseBody, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { remindTeacher } from '@/server/attendance/attendance-service';
import { remindBody } from '@/lib/validators/attendance';

/** POST /api/admin/attendance/remind — notify the course teacher of a missing register (FR-31). */
export const POST = withHandler(async (request: Request) => {
  const admin = await requireRole('ADMIN');
  const body = await parseBody(request, remindBody);
  return ok(await remindTeacher(admin, body, request));
});
