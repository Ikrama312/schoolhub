import { ok, parseQuery, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { exportGradebookCsv, getGradebook } from '@/server/gradebook/gradebook-service';
import { gradebookQuery } from '@/lib/validators/gradebook';

/** GET /api/courses/:id/gradebook?termId=[&format=csv] — manage (FR-18, FR-25). */
export const GET = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  const { termId, format } = parseQuery(new URL(request.url).searchParams, gradebookQuery);
  if (format === 'json') return ok(await getGradebook(user, params.id, termId));
  const { csv, filename } = await exportGradebookCsv(user, params.id, termId);
  return new Response(csv, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` },
  });
});
