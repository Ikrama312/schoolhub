import { ok, paginated, parseBody, parsePagination, parseQuery, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { createEvent, listEvents } from '@/server/conferences/conferences-service';
import { conferenceEventInputSchema, conferenceListQuery } from '@/lib/validators/conferences';

/** GET /api/conferences — events visible to the caller's role (FR-28, FR-42, NFR-10). */
export const GET = withHandler(async (request: Request) => {
  const user = await requireRole('ADMIN', 'TEACHER', 'PARENT');
  const searchParams = new URL(request.url).searchParams;
  const { rows, meta } = await listEvents(user, parseQuery(searchParams, conferenceListQuery), parsePagination(searchParams));
  return paginated(rows, meta);
});

/** POST /api/conferences — ADMIN creates an event (FR-28). */
export const POST = withHandler(async (request: Request) => {
  const user = await requireRole('ADMIN');
  const input = await parseBody(request, conferenceEventInputSchema);
  return ok(await createEvent(user, input, request), { status: 201 });
});
