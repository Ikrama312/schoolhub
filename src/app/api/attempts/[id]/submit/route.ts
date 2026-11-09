import { ok, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { submitForStudent } from '@/server/quiz/attempt-service';

/** POST /api/attempts/:id/submit — idempotent; returns StudentResult (FR-17). */
export const POST = withHandler(async (_request: Request, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  return ok(await submitForStudent(user, params.id));
});
