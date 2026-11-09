import { ok, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { getAttempt } from '@/server/quiz/attempt-service';

/** GET /api/attempts/:id — lazy auto-submit, then role-shaped (FR-18, FR-21, FR-34). */
export const GET = withHandler(async (_request: Request, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  return ok(await getAttempt(user, params.id));
});
