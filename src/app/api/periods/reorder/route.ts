import { ok, parseBody, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { reorderPeriods } from '@/server/timetable/timetable-service';
import { periodReorderSchema } from '@/lib/validators/timetable';

/** POST /api/periods/reorder — ADMIN (PRD-06 FR-5). */
export const POST = withHandler(async (request: Request) => {
  const actor = await requireRole('ADMIN');
  const { periodIds } = await parseBody(request, periodReorderSchema);
  return ok(await reorderPeriods(periodIds, { actorId: actor.id, request }));
});
