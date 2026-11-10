import { ok, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { getStudentInsights } from '@/server/dashboards/risk';
import { studentInsightsParams } from '@/lib/validators/dashboards';

export const dynamic = 'force-dynamic';

/** GET /api/students/:id/insights — ADMIN, or a TEACHER who can view the student (FR-43). */
export const GET = withHandler(async (_request: Request, { params }: { params: { id: string } }) => {
  const user = await requireRole('ADMIN', 'TEACHER');
  const { id } = studentInsightsParams.parse(params);
  return ok(await getStudentInsights(user, id));
});
