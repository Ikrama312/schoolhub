import { ok, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { startOrResumeAttempt } from '@/server/quiz/attempt-service';

/** POST /api/quizzes/:id/attempts — STUDENT start (201) or resume (200) (FR-13, FR-19, FR-23). */
export const POST = withHandler(async (_request: Request, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  const { attempt, created } = await startOrResumeAttempt(user, params.id);
  return ok(attempt, { status: created ? 201 : 200 });
});
