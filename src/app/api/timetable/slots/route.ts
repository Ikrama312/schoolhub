import { ok, parseBody, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { createSlot } from '@/server/timetable/timetable-service';
import { slotCreateSchema } from '@/lib/validators/timetable';

/** POST /api/timetable/slots — ADMIN (PRD-06 FR-37). 409 { clashes } on any clash. */
export const POST = withHandler(async (request: Request) => {
  const actor = await requireRole('ADMIN');
  const input = await parseBody(request, slotCreateSchema);
  return ok(await createSlot(input, { actorId: actor.id, request }), { status: 201 });
});
