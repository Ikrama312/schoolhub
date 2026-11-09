import { ok, parseBody, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { addQuestion } from '@/server/quiz/quiz-service';
import { questionSchema } from '@/lib/validators/quiz';

/** POST /api/quizzes/:id/questions — add (and Duplicate) behind the edit lock (FR-7, FR-10). */
export const POST = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  const input = await parseBody(request, questionSchema);
  return ok(await addQuestion(user, params.id, input), { status: 201 });
});
