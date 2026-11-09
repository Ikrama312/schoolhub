import { ok, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { regradeQuiz } from '@/server/quiz/quiz-service';

/** POST /api/quizzes/:id/regrade — re-run auto-grading; manual grades win (FR-10, FR-38). */
export const POST = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  return ok(await regradeQuiz(user, params.id, request));
});
