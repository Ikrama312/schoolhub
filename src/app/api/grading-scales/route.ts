import { ok, parseBody, withHandler } from '@/server/http';
import { requireRole, requireUser } from '@/server/auth/requireRole';
import { createScale, listScales } from '@/server/gradebook/scales-service';
import { scaleSchema } from '@/lib/validators/gradebook';

/** GET /api/grading-scales — any signed-in user (FR-16). */
export const GET = withHandler(async () => {
  await requireUser();
  return ok(await listScales());
});

/** POST /api/grading-scales — ADMIN. */
export const POST = withHandler(async (request: Request) => {
  const user = await requireRole('ADMIN');
  const input = await parseBody(request, scaleSchema);
  return ok(await createScale(user, input, request), { status: 201 });
});
