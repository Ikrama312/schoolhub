import { ok, parseBody, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { setAvailability } from '@/server/conferences/conferences-service';
import { availabilitySchema } from '@/lib/validators/conferences';

/** PUT /api/conferences/:id/availability — TEACHER regenerates their unbooked, unblocked slots (FR-29). */
export const PUT = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const user = await requireRole('TEACHER');
  const input = await parseBody(request, availabilitySchema);
  return ok(await setAvailability(user, params.id, input));
});
