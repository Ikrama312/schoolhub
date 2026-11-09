import { z } from 'zod';
import { ok, parseQuery, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { listUsers } from '@/server/services/users';
import { ROLE_VALUES } from '@/lib/validators/users';

const querySchema = z.object({
  role: z.enum(ROLE_VALUES).optional(),
  q: z.string().optional(),
});

const SEARCH_ROW_CAP = 20;

/** GET /api/users/search — ADMIN/TEACHER only, picker search (FR-28). Excludes archived, capped to 20 rows. */
export const GET = withHandler(async (request: Request) => {
  await requireRole('ADMIN', 'TEACHER');

  const url = new URL(request.url);
  const query = parseQuery(url.searchParams, querySchema);

  const { rows } = await listUsers(
    { role: query.role ? [query.role] : undefined, q: query.q, includeArchived: false },
    { skip: 0, take: SEARCH_ROW_CAP },
  );

  return ok(
    rows.map((row) => ({
      id: row.id,
      name: `${row.firstName} ${row.lastName}`,
      email: row.email,
      role: row.role,
    })),
  );
});
