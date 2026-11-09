import { z } from 'zod';
import { ok, paginated, parsePagination, parseQuery, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { audit } from '@/server/audit';
import { createUser, listUsers } from '@/server/services/users';
import { createUserSchema, ROLE_VALUES } from '@/lib/validators/users';

const listQuerySchema = z.object({
  role: z.string().optional(),
  status: z.enum(['ACTIVE', 'INVITED', 'DISABLED', 'ARCHIVED']).optional(),
  gradeLevelId: z.string().optional(),
  q: z.string().optional(),
  includeArchived: z.enum(['true', 'false']).optional(),
});

/** GET/POST /api/users — ADMIN only (FR-2, FR-3, FR-6..FR-10, NFR-2). */
export const GET = withHandler(async (request: Request) => {
  await requireRole('ADMIN');

  const url = new URL(request.url);
  const query = parseQuery(url.searchParams, listQuerySchema);
  const { page, pageSize, skip, take } = parsePagination(url.searchParams);

  const roleFilter = query.role
    ? query.role
        .split(',')
        .map((value) => value.trim())
        .filter((value): value is (typeof ROLE_VALUES)[number] => ROLE_VALUES.includes(value as never))
    : undefined;

  const { rows, total } = await listUsers(
    {
      role: roleFilter,
      status: query.status,
      gradeLevelId: query.gradeLevelId,
      q: query.q,
      includeArchived: query.includeArchived === 'true',
    },
    { skip, take },
  );

  return paginated(rows, { page, pageSize, total });
});

export const POST = withHandler(async (request: Request) => {
  const actor = await requireRole('ADMIN');
  const json = await request.json();
  const input = createUserSchema.parse(json);

  const user = await createUser(input);
  await audit({ actorId: actor.id, action: 'user.created', entityType: 'User', entityId: user.id });

  return ok(user, { status: 201 });
});
