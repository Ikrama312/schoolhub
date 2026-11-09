import { ok, parseBody, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { upsertAccommodation } from '@/server/quiz/quiz-service';
import { accommodationSchema } from '@/lib/validators/quiz';

/** PUT /api/quizzes/:id/accommodations/:studentId — applies to attempts started afterwards (FR-28, A7). */
export const PUT = withHandler(async (request: Request, { params }: { params: { id: string; studentId: string } }) => {
  const user = await requireUser();
  const input = await parseBody(request, accommodationSchema);
  return ok(await upsertAccommodation(user, params.id, params.studentId, input, request));
});
