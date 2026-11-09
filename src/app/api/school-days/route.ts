import { ok, parseBody, withHandler } from '@/server/http';
import { requireRole, requireUser } from '@/server/auth/requireRole';
import { listSchoolDays, updateSchoolDays } from '@/server/timetable/timetable-service';
import { schoolDaysSchema } from '@/lib/validators/timetable';

/** GET (any user) / PUT (ADMIN) /api/school-days — PRD-06 FR-7, FR-34. */
export const GET = withHandler(async () => {
  await requireUser();
  return ok(await listSchoolDays());
});

export const PUT = withHandler(async (request: Request) => {
  const actor = await requireRole('ADMIN');
  const { days } = await parseBody(request, schoolDaysSchema);
  return ok(await updateSchoolDays(days, { actorId: actor.id, request }));
});
