import { ok, parseBody, parseQuery, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { createAssignment, listCourseAssignments } from '@/server/assignments/assignments-service';
import { assignmentInput, studentQuery } from '@/lib/validators/assignments';

type Ctx = { params: { id: string } };

/** GET /api/courses/:id/assignments — role-shaped list (FR-48). View-course check in the service. */
export const GET = withHandler(async (request: Request, { params }: Ctx) => {
  const user = await requireUser();
  const { studentId } = parseQuery(new URL(request.url).searchParams, studentQuery);
  return ok(await listCourseAssignments(user, params.id, studentId));
});

/** POST /api/courses/:id/assignments — create (FR-49). assertCanManageCourse in the service. */
export const POST = withHandler(async (request: Request, { params }: Ctx) => {
  const user = await requireUser();
  const input = await parseBody(request, assignmentInput);
  return ok(await createAssignment(user, params.id, input, request), { status: 201 });
});
