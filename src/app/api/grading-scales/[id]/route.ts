import { ok, parseBody, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { deleteScale, updateScale } from '@/server/gradebook/scales-service';
import { scalePatchSchema } from '@/lib/validators/gradebook';

type Ctx = { params: { id: string } };

/** PATCH /api/grading-scales/:id — ADMIN (FR-16). */
export const PATCH = withHandler(async (request: Request, { params }: Ctx) => {
  const user = await requireRole('ADMIN');
  const patch = await parseBody(request, scalePatchSchema);
  return ok(await updateScale(user, params.id, patch, request));
});

/** DELETE /api/grading-scales/:id — ADMIN; CONFLICT when default or in use (A11). */
export const DELETE = withHandler(async (request: Request, { params }: Ctx) => {
  const user = await requireRole('ADMIN');
  return ok(await deleteScale(user, params.id, request));
});
