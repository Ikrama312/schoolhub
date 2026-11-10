import { ok, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { cancel } from '@/server/conferences/conferences-service';

/** POST /api/conference-slots/:id/cancel — booking parent or ADMIN, before bookingClosesAt (FR-32, FR-33). */
export const POST = withHandler(async (_request: Request, { params }: { params: { id: string } }) => {
  const user = await requireRole('PARENT', 'ADMIN', 'TEACHER');
  return ok(await cancel(user, params.id));
});
