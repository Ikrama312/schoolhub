import { ok, parseBody, withHandler } from '@/server/http';
import { resetPasswordSchema } from '@/lib/validators/auth';
import { resetPassword } from '@/server/services/auth';

/** POST /api/auth/reset-password — public; 410 for an invalid/expired/used token (FR-21). */
export const POST = withHandler(async (request: Request) => {
  const body = await parseBody(request, resetPasswordSchema);
  return ok(await resetPassword(body, request));
});
