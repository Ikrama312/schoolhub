import { ok, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { getMyFees } from '@/server/fees/reports';

/** GET /api/me/fees — PARENT only; everything the /fees page needs (FR-39). */
export const GET = withHandler(async () => {
  const parent = await requireRole('PARENT');
  return ok(await getMyFees(parent));
});
