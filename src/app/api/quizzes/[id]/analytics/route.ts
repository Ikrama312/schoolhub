import { ok, parseQuery, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { analyticsCsv, getQuizAnalytics } from '@/server/quiz/analytics';
import { analyticsQuery } from '@/lib/validators/quiz';

/** GET /api/quizzes/:id/analytics[?format=csv] (FR-26, FR-27). */
export const GET = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  const { format } = parseQuery(new URL(request.url).searchParams, analyticsQuery);
  if (format === 'json') return ok(await getQuizAnalytics(user, params.id));
  return new Response(await analyticsCsv(user, params.id), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="quiz-${params.id}-attempts.csv"`,
    },
  });
});
