import { z } from 'zod';
import { parseQuery, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { listUsers } from '@/server/services/users';
import { toCsv } from '@/server/csv';
import { ROLE_VALUES } from '@/lib/validators/users';

const querySchema = z.object({
  role: z.string().optional(),
  status: z.enum(['ACTIVE', 'INVITED', 'DISABLED', 'ARCHIVED']).optional(),
  gradeLevelId: z.string().optional(),
  q: z.string().optional(),
  includeArchived: z.enum(['true', 'false']).optional(),
});

// ponytail: single un-paginated page capped at NFR-2's 5,000-row budget —
// switch to a streamed/chunked export if the school ever exceeds that.
const EXPORT_ROW_CAP = 5000;

const COLUMNS = [
  { key: 'firstName', header: 'First Name' },
  { key: 'lastName', header: 'Last Name' },
  { key: 'email', header: 'Email' },
  { key: 'role', header: 'Role' },
  { key: 'status', header: 'Status' },
  { key: 'gradeLevelName', header: 'Grade Level' },
  { key: 'lastLoginAt', header: 'Last Sign-In' },
];

/** GET /api/users/export — ADMIN only, same filters as the list (FR-5, NFR-1, NFR-4). medicalNotes is never part of this projection. */
export const GET = withHandler(async (request: Request) => {
  await requireRole('ADMIN');

  const url = new URL(request.url);
  const query = parseQuery(url.searchParams, querySchema);
  const roleFilter = query.role
    ? query.role
        .split(',')
        .map((value) => value.trim())
        .filter((value): value is (typeof ROLE_VALUES)[number] => ROLE_VALUES.includes(value as never))
    : undefined;

  const { rows } = await listUsers(
    {
      role: roleFilter,
      status: query.status,
      gradeLevelId: query.gradeLevelId,
      q: query.q,
      includeArchived: query.includeArchived === 'true',
    },
    { skip: 0, take: EXPORT_ROW_CAP },
  );

  const csv = toCsv(
    COLUMNS,
    rows.map((row) => ({ ...row, lastLoginAt: row.lastLoginAt?.toISOString() ?? '' })),
  );

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="users-export.csv"',
    },
  });
});
