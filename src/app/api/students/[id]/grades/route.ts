import { ok, parseQuery, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { getStudentGrades } from '@/server/gradebook/student-grades-service';
import { studentGradesQuery } from '@/lib/validators/gradebook';

/** GET /api/students/:id/grades?termId=&courseId= — view student; visible items only (FR-42). */
export const GET = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  const { termId, courseId } = parseQuery(new URL(request.url).searchParams, studentGradesQuery);
  return ok(await getStudentGrades(user, params.id, termId, courseId));
});
