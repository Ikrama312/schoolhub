import { ok, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { getCourseMatrix } from '@/server/attendance/attendance-service';

/** GET /api/courses/:id/attendance — last 20 sessions × students; assertCanManageCourse in the service (FR-29). */
export const GET = withHandler(async (_request: Request, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  return ok(await getCourseMatrix(user, params.id));
});
