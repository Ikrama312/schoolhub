import { paginated, parsePagination, parseQuery, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { tracking } from '@/server/consent-forms/consent-forms-service';
import { trackingQuery } from '@/lib/validators/consent-forms';

/** GET /api/consent-forms/:id/tracking[?format=csv] — creator or ADMIN (FR-39). */
export const GET = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const user = await requireRole('ADMIN', 'TEACHER');
  const searchParams = new URL(request.url).searchParams;
  const result = await tracking(user, params.id, parseQuery(searchParams, trackingQuery), parsePagination(searchParams));
  if ('csv' in result) {
    const name = (result.title ?? 'consent').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'consent';
    return new Response(result.csv, {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}-responses.csv"` },
    });
  }
  return paginated(result.rows, result.meta);
});
