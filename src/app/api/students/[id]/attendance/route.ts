import { ok, parseQuery, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { getStudentAttendance } from '@/server/attendance/attendance-service';
import { studentAttendanceQuery } from '@/lib/validators/attendance';

/** GET /api/students/:id/attendance?from&to — assertCanViewStudent inside the service (FR-25..28). */
export const GET = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  const range = parseQuery(new URL(request.url).searchParams, studentAttendanceQuery);
  return ok(await getStudentAttendance(user, params.id, range));
});
