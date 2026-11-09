import { ok, parseBody, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { reorderQuestions } from '@/server/quiz/quiz-service';
import { reorderSchema } from '@/lib/validators/quiz';

/** POST /api/quizzes/:id/questions/reorder — full permutation (FR-7). */
export const POST = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  const { questionIds } = await parseBody(request, reorderSchema);
  return ok(await reorderQuestions(user, params.id, questionIds));
});
