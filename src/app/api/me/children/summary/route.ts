import { ok, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { getChildrenSummary } from '@/server/parent/overview-service';

/** GET /api/me/children/summary — PARENT; one card per linked child (FR-7). */
export const GET = withHandler(async () => {
  const user = await requireRole('PARENT');
  return ok(await getChildrenSummary(user));
});
