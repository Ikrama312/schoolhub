import { ok, parseBody, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { deleteQuestion, updateQuestion } from '@/server/quiz/quiz-service';
import { questionPatchSchema } from '@/lib/validators/quiz';

type Ctx = { params: { id: string } };

/** PATCH /api/questions/:id — edit, limited by the edit lock (FR-7, FR-10). */
export const PATCH = withHandler(async (request: Request, { params }: Ctx) => {
  const user = await requireUser();
  const patch = await parseBody(request, questionPatchSchema);
  return ok(await updateQuestion(user, params.id, patch));
});

/** DELETE /api/questions/:id — blocked by the edit lock. */
export const DELETE = withHandler(async (_request: Request, { params }: Ctx) => {
  const user = await requireUser();
  return ok(await deleteQuestion(user, params.id));
});
