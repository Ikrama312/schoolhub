import { ok, parseBody, withHandler } from '@/server/http';
import { forgotPasswordSchema } from '@/lib/validators/auth';
import { requestPasswordReset } from '@/server/services/auth';

/** POST /api/auth/forgot-password — public; always the same 200 body, 429 per IP (FR-19). */
export const POST = withHandler(async (request: Request) => {
  const body = await parseBody(request, forgotPasswordSchema);
  return ok(await requestPasswordReset(body, request));
});
