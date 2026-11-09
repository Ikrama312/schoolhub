import { ok, parseBody, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { unpublish } from '@/server/report-cards/report-card-service';
import { unpublishSchema } from '@/lib/validators/gradebook';

/** POST /api/report-cards/unpublish — ADMIN; reason required, audited (FR-34, NFR-4). */
export const POST = withHandler(async (request: Request) => {
  const user = await requireRole('ADMIN');
  const { ids, reason } = await parseBody(request, unpublishSchema);
  return ok(await unpublish(user, ids, reason, request));
});
