import { ok, parseBody, withHandler } from '@/server/http';
import { acceptInviteSchema } from '@/lib/validators/auth';
import { acceptInvite } from '@/server/services/auth';

/** POST /api/auth/accept-invite — public; activates an invited account (FR-16). */
export const POST = withHandler(async (request: Request) => {
  const body = await parseBody(request, acceptInviteSchema);
  return ok(await acceptInvite(body, request));
});
