import { paginated, parseQuery, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { toCsv } from '@/server/csv';
import { AT_RISK_COLUMNS, atRiskCsvRow, listAtRisk } from '@/server/dashboards/risk';
import { atRiskQuery } from '@/lib/validators/dashboards';

export const dynamic = 'force-dynamic';

/** GET /api/insights/at-risk — scoped, filtered list; ?format=csv returns every filtered row (FR-29, FR-30, FR-42). */
export const GET = withHandler(async (request: Request) => {
  const user = await requireRole('ADMIN', 'TEACHER');
  const { format, page, pageSize, ...filters } = parseQuery(new URL(request.url).searchParams, atRiskQuery);
  if (format === 'csv') {
    const { rows } = await listAtRisk(user, filters);
    return new Response(toCsv(AT_RISK_COLUMNS, rows.map(atRiskCsvRow)), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="at-risk-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }
  const { rows, total, computedAt } = await listAtRisk(user, filters, { page, pageSize });
  return paginated(rows, { page, pageSize, total, computedAt } as { page: number; pageSize: number; total: number });
});
