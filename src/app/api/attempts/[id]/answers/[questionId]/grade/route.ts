import { ok, parseBody, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { gradeAnswerManually } from '@/server/quiz/attempt-service';
import { manualGradeSchema } from '@/lib/validators/quiz';

/** PUT /api/attempts/:id/answers/:questionId/grade — manual grade / override (FR-24, FR-25, FR-38). */
export const PUT = withHandler(async (request: Request, { params }: { params: { id: string; questionId: string } }) => {
  const user = await requireUser();
  const input = await parseBody(request, manualGradeSchema);
  return ok(await gradeAnswerManually(user, params.id, params.questionId, input, request));
});
