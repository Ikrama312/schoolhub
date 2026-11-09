import { ok, paginated, parseBody, parsePagination, parseQuery, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { createSection, listSections } from '@/server/sections/sections-service';
import { sectionInputSchema, sectionsListQuerySchema } from '@/lib/validators/sections';

/** GET /api/sections (ADMIN, TEACHER) · POST /api/sections (ADMIN) — PRD-05 FR-2/FR-3. */
export const GET = withHandler(async (request: Request) => {
  await requireRole('ADMIN', 'TEACHER');
  const url = new URL(request.url);
  const query = parseQuery(url.searchParams, sectionsListQuerySchema);
  const { page, pageSize, skip, take } = parsePagination(url.searchParams);
  const { rows, total } = await listSections(query, { skip, take });
  return paginated(rows, { page, pageSize, total });
});

export const POST = withHandler(async (request: Request) => {
  const actor = await requireRole('ADMIN');
  const input = await parseBody(request, sectionInputSchema);
  return ok(await createSection(input, actor.id), { status: 201 });
});
