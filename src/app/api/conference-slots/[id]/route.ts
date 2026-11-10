import { ok, parseBody, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { patchSlot, removeSlot } from '@/server/conferences/conferences-service';
import { slotPatchSchema } from '@/lib/validators/conferences';

type Ctx = { params: { id: string } };

/** PATCH /api/conference-slots/:id — slot teacher or ADMIN blocks/unblocks or edits location (FR-29). */
export const PATCH = withHandler(async (request: Request, { params }: Ctx) => {
  const user = await requireRole('TEACHER', 'ADMIN');
  return ok(await patchSlot(user, params.id, await parseBody(request, slotPatchSchema)));
});

/** DELETE /api/conference-slots/:id — unbooked only (FR-29). */
export const DELETE = withHandler(async (_request: Request, { params }: Ctx) => {
  const user = await requireRole('TEACHER', 'ADMIN');
  return ok(await removeSlot(user, params.id));
});
