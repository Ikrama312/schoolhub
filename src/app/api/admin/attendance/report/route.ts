import { paginated, parsePagination, parseQuery, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { toCsv } from '@/server/csv';
import { getReport } from '@/server/attendance/attendance-service';
import { reportFilters } from '@/lib/validators/attendance';

const COLUMNS = [
  { key: 'studentName', header: 'Student' },
  { key: 'sectionName', header: 'Section' },
  { key: 'gradeLevelName', header: 'Grade' },
  { key: 'records', header: 'Records' },
  { key: 'present', header: 'Present' },
  { key: 'absent', header: 'Absent' },
  { key: 'late', header: 'Late' },
  { key: 'excused', header: 'Excused' },
  { key: 'rate', header: 'Rate' },
];

/** GET /api/admin/attendance/report — per-student summary; paginated JSON or ?format=csv (FR-32). */
export const GET = withHandler(async (request: Request) => {
  await requireRole('ADMIN');
  const url = new URL(request.url);
  const filters = parseQuery(url.searchParams, reportFilters);
  const rows = await getReport(filters);
  if (filters.format === 'csv') {
    return new Response(toCsv(COLUMNS, rows), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="attendance-report-${filters.from}-${filters.to}.csv"`,
      },
    });
  }
  const { page, pageSize, skip, take } = parsePagination(url.searchParams);
  return paginated(rows.slice(skip, skip + take), { page, pageSize, total: rows.length });
});
