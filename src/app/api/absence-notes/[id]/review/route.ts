import { ok, parseBody, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { review } from '@/server/absence-notes/absence-notes-service';
import { reviewSchema } from '@/lib/validators/absence-notes';

/** POST /api/absence-notes/:id/review — homeroom TEACHER or ADMIN (FR-22, FR-23, FR-26). */
export const POST = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const user = await requireRole('TEACHER', 'ADMIN');
  const input = await parseBody(request, reviewSchema);
  return ok(await review(user, params.id, input, request));
});
