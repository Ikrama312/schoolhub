import { ok, parseBody, withHandler } from '@/server/http';
import { requireRole, requireUser } from '@/server/auth/requireRole';
import { createPeriod, listPeriods } from '@/server/timetable/timetable-service';
import { periodSchema } from '@/lib/validators/timetable';

/** GET (any user) / POST (ADMIN) /api/periods — PRD-06 FR-33. */
export const GET = withHandler(async () => {
  await requireUser();
  return ok(await listPeriods());
});

export const POST = withHandler(async (request: Request) => {
  const actor = await requireRole('ADMIN');
  const input = await parseBody(request, periodSchema);
  return ok(await createPeriod(input, { actorId: actor.id, request }), { status: 201 });
});
