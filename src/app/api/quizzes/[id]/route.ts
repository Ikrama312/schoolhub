import { ok, parseBody, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { deleteQuiz, getQuiz, updateQuiz } from '@/server/quiz/quiz-service';
import { quizPatchSchema } from '@/lib/validators/quiz';

type Ctx = { params: { id: string } };

/** GET /api/quizzes/:id — ManagerQuiz for managers, StudentQuiz otherwise (NFR-1). */
export const GET = withHandler(async (_request: Request, { params }: Ctx) => {
  const user = await requireUser();
  return ok(await getQuiz(user, params.id));
});

/** PATCH /api/quizzes/:id — settings and DRAFT→PUBLISHED→CLOSED (FR-6, FR-9, FR-29). */
export const PATCH = withHandler(async (request: Request, { params }: Ctx) => {
  const user = await requireUser();
  const patch = await parseBody(request, quizPatchSchema);
  return ok(await updateQuiz(user, params.id, patch, request));
});

/** DELETE /api/quizzes/:id — only without attempts. */
export const DELETE = withHandler(async (request: Request, { params }: Ctx) => {
  const user = await requireUser();
  return ok(await deleteQuiz(user, params.id, request));
});
