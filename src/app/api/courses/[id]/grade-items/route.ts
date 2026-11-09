import { ok, parseBody, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { createManualItem } from '@/server/gradebook/gradebook-service';
import { manualItemSchema } from '@/lib/validators/gradebook';

/** POST /api/courses/:id/grade-items — manage; MANUAL items only (FR-22). */
export const POST = withHandler(async (request: Request, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  const input = await parseBody(request, manualItemSchema);
  return ok(await createManualItem(user, params.id, input, request), { status: 201 });
});
