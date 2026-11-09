import { ok, parseBody, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { moveStudent } from '@/server/sections/sections-service';
import { moveSectionSchema } from '@/lib/validators/sections';

/** POST /api/students/:id/move-section — ADMIN, one transaction (FR-9). */
export const POST = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const actor = await requireRole('ADMIN');
  const input = await parseBody(request, moveSectionSchema);
  return ok(await moveStudent(params.id, input, actor.id));
});
