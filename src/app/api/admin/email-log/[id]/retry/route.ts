import { ok, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { retryEmail } from '@/server/email/admin';

type Ctx = { params: { id: string } };

/** POST /api/admin/email-log/:id/retry — ADMIN (FR-32, FR-39). */
export const POST = withHandler(async (_request: Request, { params }: Ctx) => {
  await requireRole('ADMIN');
  return ok(await retryEmail(params.id));
});
