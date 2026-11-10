import { ok, parseBody, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { book } from '@/server/conferences/conferences-service';
import { bookingSchema } from '@/lib/validators/conferences';

/** POST /api/conference-slots/:id/book — PARENT, atomic (FR-30 to FR-33, NFR-1). */
export const POST = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const user = await requireRole('PARENT');
  return ok(await book(user, params.id, await parseBody(request, bookingSchema)));
});
