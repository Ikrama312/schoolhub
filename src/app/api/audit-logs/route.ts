import { z } from 'zod';
import { prisma } from '@/server/db';
import { paginated, parsePagination, parseQuery, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';

const querySchema = z.object({
  actorId: z.string().optional(),
  actionPrefix: z.string().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  page: z.string().optional(),
  pageSize: z.string().optional(),
});

/**
 * GET /api/audit-logs -- read-only view over the existing AuditLog table
 * (src/server/audit.ts's schema). No write path here; audit() remains the
 * only writer.
 */
export const GET = withHandler(async (request: Request) => {
  await requireRole('ADMIN');

  const url = new URL(request.url);
  const query = parseQuery(url.searchParams, querySchema);
  const { page, pageSize, skip, take } = parsePagination(url.searchParams);

  const where = {
    ...(query.actorId ? { actorId: query.actorId } : {}),
    ...(query.actionPrefix ? { action: { startsWith: query.actionPrefix } } : {}),
    ...(query.dateFrom || query.dateTo
      ? {
          createdAt: {
            ...(query.dateFrom ? { gte: query.dateFrom } : {}),
            ...(query.dateTo ? { lte: query.dateTo } : {}),
          },
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { actor: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.auditLog.count({ where }),
  ]);

  const data = rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    actorId: row.actorId,
    actorName: row.actor ? `${row.actor.firstName} ${row.actor.lastName}` : null,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    ip: row.ip,
    metadata: row.metadata,
  }));

  return paginated(data, { page, pageSize, total });
});
