import { NextResponse } from 'next/server';
import { parsePagination, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { getBelowThreshold } from '@/server/attendance/attendance-service';

/** GET /api/admin/attendance/below-threshold — year-to-date rate below the alert threshold, ascending (FR-33). */
export const GET = withHandler(async (request: Request) => {
  await requireRole('ADMIN');
  const { page, pageSize, skip, take } = parsePagination(new URL(request.url).searchParams);
  const { threshold, rows } = await getBelowThreshold();
  // Same envelope as paginated(), plus meta.threshold (api-contracts).
  return NextResponse.json({ data: rows.slice(skip, skip + take), meta: { page, pageSize, total: rows.length, threshold } });
});
