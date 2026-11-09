import { ok, parseBody, parseQuery, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { deleteOrArchiveAssignment, getAssignment, updateAssignment } from '@/server/assignments/assignments-service';
import { assignmentPatch, studentQuery } from '@/lib/validators/assignments';

type Ctx = { params: { id: string } };

/** GET /api/assignments/:id (FR-50) · PATCH / DELETE (FR-51). Course access is checked in the service. */
export const GET = withHandler(async (request: Request, { params }: Ctx) => {
  const user = await requireUser();
  const { studentId } = parseQuery(new URL(request.url).searchParams, studentQuery);
  return ok(await getAssignment(user, params.id, studentId));
});

export const PATCH = withHandler(async (request: Request, { params }: Ctx) => {
  const user = await requireUser();
  const patch = await parseBody(request, assignmentPatch);
  return ok(await updateAssignment(user, params.id, patch, request));
});

export const DELETE = withHandler(async (request: Request, { params }: Ctx) => {
  const user = await requireUser();
  return ok(await deleteOrArchiveAssignment(user, params.id, request));
});
