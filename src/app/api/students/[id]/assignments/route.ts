import { z } from 'zod';
import { ok, parseQuery, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { listStudentAssignments } from '@/server/assignments/assignments-service';

const query = z.object({ courseId: z.string().min(1).optional() });

/** GET /api/students/:id/assignments — per-student list; assertCanViewStudent in the service (FR-58). */
export const GET = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  const { courseId } = parseQuery(new URL(request.url).searchParams, query);
  return ok(await listStudentAssignments(user, params.id, courseId));
});
