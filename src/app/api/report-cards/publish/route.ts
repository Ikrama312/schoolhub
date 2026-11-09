import { ok, parseBody, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { publish } from '@/server/report-cards/report-card-service';
import { publishSchema } from '@/lib/validators/gradebook';

/** POST /api/report-cards/publish — ADMIN (FR-34). */
export const POST = withHandler(async (request: Request) => {
  const user = await requireRole('ADMIN');
  const { ids } = await parseBody(request, publishSchema);
  return ok(await publish(user, ids, request));
});
