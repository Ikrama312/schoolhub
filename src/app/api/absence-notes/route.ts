import { ok, paginated, parseBody, parsePagination, parseQuery, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { list, submit } from '@/server/absence-notes/absence-notes-service';
import { absenceNoteInputSchema, absenceNoteListQuery } from '@/lib/validators/absence-notes';

/** GET /api/absence-notes — role-scoped, paginated (FR-20, FR-21, NFR-10). */
export const GET = withHandler(async (request: Request) => {
  const user = await requireRole('PARENT', 'TEACHER', 'ADMIN');
  const searchParams = new URL(request.url).searchParams;
  const query = parseQuery(searchParams, absenceNoteListQuery);
  const { rows, meta } = await list(user, query, parsePagination(searchParams));
  return paginated(rows, meta);
});

/** POST /api/absence-notes — PARENT, linked child only (FR-18, FR-19). */
export const POST = withHandler(async (request: Request) => {
  const user = await requireRole('PARENT');
  const input = await parseBody(request, absenceNoteInputSchema);
  return ok(await submit(user, input), { status: 201 });
});
