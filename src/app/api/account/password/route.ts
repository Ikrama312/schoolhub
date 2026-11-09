import { ok, parseBody, withHandler } from '@/server/http';
import { requireUser } from '@/server/auth/requireRole';
import { changePasswordSchema } from '@/lib/validators/auth';
import { changePassword } from '@/server/services/auth';
import { unstable_update } from '@/server/auth/auth';

/** POST /api/account/password — signed-in password change (FR-23). */
export const POST = withHandler(async (request: Request) => {
  const user = await requireUser();
  const body = await parseBody(request, changePasswordSchema);
  await changePassword(user, body, request);
  // Move this session's authTime past passwordChangedAt so only *other* sessions are revoked.
  await unstable_update({ reauth: true } as Parameters<typeof unstable_update>[0]);
  return ok({ ok: true });
});
