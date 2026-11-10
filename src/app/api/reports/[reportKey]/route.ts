import { ok, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { toCsv } from '@/server/csv';
import { runReport } from '@/server/reports';

export const dynamic = 'force-dynamic';

/** GET /api/reports/:reportKey — ADMIN; unknown key → 404; ?format=csv → the same rows as CSV (FR-44, FR-35 AC 7). */
export const GET = withHandler(async (request: Request, { params }: { params: { reportKey: string } }) => {
  await requireRole('ADMIN');
  const query = Object.fromEntries(new URL(request.url).searchParams.entries());
  const result = await runReport(params.reportKey, query);
  if (result.filters.format === 'csv') {
    return new Response(toCsv(result.columns, result.rows), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${result.key}-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }
  return ok(result);
});
