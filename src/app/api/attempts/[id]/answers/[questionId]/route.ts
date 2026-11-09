import { ok, parseBody, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { saveAnswer } from '@/server/quiz/attempt-service';
import { answerResponseSchema } from '@/lib/validators/quiz';

export const dynamic = 'force-dynamic';

/** PUT /api/attempts/:id/answers/:questionId — autosave hot path; no grading data back (FR-15, FR-16, NFR-2). */
export const PUT = withHandler(async (request: Request, { params }: { params: { id: string; questionId: string } }) => {
  const user = await requireUser();
  const { response } = await parseBody(request, answerResponseSchema);
  return ok(await saveAnswer(user, params.id, params.questionId, response));
});
