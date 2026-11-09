import { ok, parseBody, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { deleteSlot, moveSlot } from '@/server/timetable/timetable-service';
import { slotUpdateSchema } from '@/lib/validators/timetable';

type Ctx = { params: { id: string } };

/** PATCH (move / change room) and DELETE /api/timetable/slots/:id — ADMIN (PRD-06 FR-37). */
export const PATCH = withHandler(async (request: Request, { params }: Ctx) => {
  const actor = await requireRole('ADMIN');
  const patch = await parseBody(request, slotUpdateSchema);
  return ok(await moveSlot(params.id, patch, { actorId: actor.id, request }));
});

export const DELETE = withHandler(async (request: Request, { params }: Ctx) => {
  const actor = await requireRole('ADMIN');
  return ok(await deleteSlot(params.id, { actorId: actor.id, request }));
});
