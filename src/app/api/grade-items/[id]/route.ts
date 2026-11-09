import { ok, parseBody, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { deleteItem, updateItem } from '@/server/gradebook/gradebook-service';
import { itemPatchSchema } from '@/lib/validators/gradebook';

type Ctx = { params: { id: string } };

/** PATCH /api/grade-items/:id — MANUAL: every field; synced: isVisible only (FR-9, FR-24). */
export const PATCH = withHandler(async (request: Request, { params }: Ctx) => {
  const user = await requireUser();
  const patch = await parseBody(request, itemPatchSchema);
  return ok(await updateItem(user, params.id, patch, request));
});

/** DELETE /api/grade-items/:id — MANUAL only. */
export const DELETE = withHandler(async (request: Request, { params }: Ctx) => {
  const user = await requireUser();
  return ok(await deleteItem(user, params.id, request));
});
