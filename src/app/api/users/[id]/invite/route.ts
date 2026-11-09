import { ok, withHandler } from '@/server/http';
import { requireRole } from '@/server/auth/requireRole';
import { audit } from '@/server/audit';
import { sendInvite } from '@/server/services/users';

/** POST /api/users/:id/invite — ADMIN only, resend invite (FR-7). */
export const POST = withHandler(async (_request: Request, { params }: { params: { id: string } }) => {
  const actor = await requireRole('ADMIN');
  const result = await sendInvite(params.id);
  await audit({ actorId: actor.id, action: 'user.invite_resent', entityType: 'User', entityId: params.id });
  return ok(result);
});
