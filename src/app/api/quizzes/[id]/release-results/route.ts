import { ok, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { releaseResults } from '@/server/quiz/quiz-service';

/** POST /api/quizzes/:id/release-results — MANUAL visibility only; repeat is a no-op (FR-20, FR-30). */
export const POST = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  return ok(await releaseResults(user, params.id, request));
});
