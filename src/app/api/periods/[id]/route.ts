import { ok, parseBody, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { deletePeriod, updatePeriod } from '@/server/timetable/timetable-service';
import { periodUpdateSchema } from '@/lib/validators/timetable';

type Ctx = { params: { id: string } };

/** PATCH/DELETE /api/periods/:id — ADMIN (PRD-06 FR-6, FR-8, FR-33). */
export const PATCH = withHandler(async (request: Request, { params }: Ctx) => {
  const actor = await requireRole('ADMIN');
  const input = await parseBody(request, periodUpdateSchema);
  return ok(await updatePeriod(params.id, input, { actorId: actor.id, request }));
});

export const DELETE = withHandler(async (request: Request, { params }: Ctx) => {
  const actor = await requireRole('ADMIN');
  return ok(await deletePeriod(params.id, { actorId: actor.id, request }));
});
