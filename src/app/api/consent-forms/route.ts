import { ok, paginated, parseBody, parsePagination, parseQuery, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { create, list } from '@/server/consent-forms/consent-forms-service';
import { consentFormInputSchema, consentListQuery } from '@/lib/validators/consent-forms';

/** GET /api/consent-forms — PARENT: audience forms with children[]; TEACHER: own; ADMIN: all (FR-37, NFR-10). */
export const GET = withHandler(async (request: Request) => {
  const user = await requireRole('ADMIN', 'TEACHER', 'PARENT');
  const searchParams = new URL(request.url).searchParams;
  const { rows, meta } = await list(user, parseQuery(searchParams, consentListQuery), parsePagination(searchParams));
  return paginated(rows, meta);
});

/** POST /api/consent-forms — ADMIN (any audience) or TEACHER (managed courses) (FR-36). */
export const POST = withHandler(async (request: Request) => {
  const user = await requireRole('ADMIN', 'TEACHER');
  return ok(await create(user, await parseBody(request, consentFormInputSchema), request), { status: 201 });
});
