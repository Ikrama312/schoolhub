import { ok, paginated, parseBody, parsePagination, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { createQuiz, listCourseQuizzes } from '@/server/quiz/quiz-service';
import { quizCreateSchema } from '@/lib/validators/quiz';

type Ctx = { params: { id: string } };

/** GET /api/courses/:id/quizzes — role-shaped, paginated (FR-11). View check in the service. */
export const GET = withHandler(async (request: Request, { params }: Ctx) => {
  const user = await requireUser();
  const { items, meta } = await listCourseQuizzes(user, params.id, parsePagination(new URL(request.url).searchParams));
  return paginated<(typeof items)[number]>(items, meta);
});

/** POST /api/courses/:id/quizzes — create a DRAFT (FR-6). */
export const POST = withHandler(async (request: Request, { params }: Ctx) => {
  const user = await requireUser();
  const input = await parseBody(request, quizCreateSchema);
  return ok(await createQuiz(user, params.id, input, request), { status: 201 });
});
